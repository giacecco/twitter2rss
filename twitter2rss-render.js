"use strict";

const async = require("async"),
      Feed = require('feed'),
      fs = require("fs-extra"),
      path = require("path"),
      // https://github.com/mapbox/node-sqlite3
      sqlite3 = require('sqlite3').verbose(),
      _ = require("underscore"),
      argv = require('yargs')
          .default("loglevel", "error")
          .argv;

const t2rShared = new require("./twitter2rss-shared")();

const // A Twitter burst is defined by two tweets being published at most this
      // close (milliseconds)
      TWEET_BURST = 300000,
      // From http://stackoverflow.com/a/3809435 + change to support 1-character
      // second level domains.
      URL_REGEX = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi);

const init = function (callback) {

    async.series([

        // shared functionality initialisation
        function (callback) {
            t2rShared.init(argv, callback);
        },

    ], function (err) {
        if (err) {
            t2rShared.getLogger().error("Initialisation failed: " + err.message);
            return process.exit(1);
        }
        t2rShared.getLogger().info("Initialisation completed.");
        callback(null);
    });
}

const main = function () {

    const loadTweets = function (configuration, callback) {
        var sqliteFilename = path.join(t2rShared.getDataPath(), "feeds", configuration.name + ".sqlite3");
        fs.stat(sqliteFilename, function (err, stat) {
            if (err) return callback(null, [ ]);
            var db = new sqlite3.Database(sqliteFilename, sqlite3.OPEN_READONLY, function (err) {
                if (err) {
                    t2rShared.getLogger().error("Error opening the sqlite3 cache for configuration " + configuration.name + ". Error message is: " + err.message);
                    return process.exit(1);
                }
                db.all("SELECT * FROM tweets;", function (err, results) {
                    if (err) return callback(null, [ ]);
                    callback(null, results.map(function (row) { return JSON.parse(row.payload); }));
                });
            });
        });
    }

    const cleanUpTweets = function (configuration, tweets, callback) {

        // This function returns an array of arrays of tweets, grouped by the
        // user's screen name.
        const splitTweetsByScreenname = function (_tweets) {
            var tweets = JSON.parse(JSON.stringify(_tweets)),
                results = _.uniq(_.pluck(_.pluck(tweets, "user"), "screen_name")).map(function (screenName) {
                return tweets.filter(function (t) { return t.user.screen_name === screenName; });
            });
            return(results);
        }

        // This function returns an array of arrays of tweets, grouped in
        // "buckets" made of consecutive tweets whose timestamp is within
        // _lapse_ milliseconds of each other.
        const bucketTweetsByTime = function (_tweets, lapse) {
            var tweets = JSON.parse(JSON.stringify(_tweets)),
                tweet = null,
                results = [ ],
                currentGroup = [ ];
            tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });
            // sort in reverse chronological order, to use pop below
            tweets.sort(function (a, b) { return b.created_at - a.created_at; });
            while(tweet = tweets.pop()) {
                if ((currentGroup.length === 0) || (tweet.created_at - _.last(currentGroup).created_at <= lapse)) {
                    // this is the earliest tweet, or the tweet is within lapse
                    // from the previous, it falls in the same group
                    currentGroup.push(tweet);
                } else {
                    // the tweet is not within lapse from the previous; the
                    // previous group is complete, and another is started
                    results.push(currentGroup);
                    currentGroup = [ tweet ];
                }
            }
            results.push(currentGroup);
            return(results);
        }

        // This function aggregates an array of tweets into one tweet, built
        // by concatenating all tweets' text into the first tweet's.
        const aggregateTweets = function (tweets) {
            // just return the original tweet if there isn't more than 1!
            if (tweets.length < 2) return tweets[0];
            // ... otherwise do the actual aggregation
            var newTweet = tweets[0];
            for (var i = 1; i < tweets.length; i++)
                newTweet.text += (
                    "<br>" +
                    ("0" + tweets[i].created_at.getHours()).slice(-2) +
                    ":" +
                    ("0" + tweets[i].created_at.getMinutes()).slice(-2) +
                    " - " +
                    tweets[i].text
                );
            return newTweet;
        }

        // This function gets an array of tweets and replaces bursts of tweets
        // by the same user with a single tweet.
        const consolidateTweetBursts = function (tweets, lapse) {
            return(_.flatten(splitTweetsByScreenname(tweets).map(function (userTweets) {
                return(bucketTweetsByTime(userTweets, lapse).map(aggregateTweets));
            }), true));
        }

        // identifies tweets whose text is identical but by the hashtags and
        // URLs they include, and keeps the oldest only
        const consolidateDuplicates = _tweets => {
            let tweets = JSON.parse(JSON.stringify(_tweets));
            tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });
            return _.values(tweets.reduce((memo, t) => {
                t.cleaned = t.text
                    .replace(URL_REGEX, "")
                    .replace(/#[\w-]+/g, "")
                    .replace(/\s\s+/, " "); // see http://stackoverflow.com/a/1981366
                memo[t.cleaned] = !memo[t.cleaned] ? t : (memo[t.cleaned].created_at < t.created_at ? memo[t.cleaned] : t);
                return memo;
            }, { }));
        }

        // This function splits the input tweets in groups made of tweets whose
        // text is sufficiently similar, then returns the earliest tweet from
        // each group.
        // Similarity between two strings is calculated as the proportion
        // between their Levenstein distance and the length of the longest
        // tweet.
        // Similarity is sufficient when the aforementioned "score" is not
        // higher than _tolerance_.
        const consolidateAlmostDuplicates = (_tweets, tolerance) => {

            // From https://gist.github.com/andrei-m/982927#gistcomment-1797205
            const levenstein = (a, b) => {
                var m = [], i, j, min = Math.min;
                if (!(a && b)) return (b || a).length;
                for (i = 0; i <= b.length; m[i] = [i++]);
                for (j = 0; j <= a.length; m[0][j] = j++);
                for (i = 1; i <= b.length; i++) {
                    for (j = 1; j <= a.length; j++) {
                        m[i][j] = b.charAt(i - 1) == a.charAt(j - 1)
                            ? m[i - 1][j - 1]
                            : m[i][j] = min(
                                m[i - 1][j - 1] + 1,
                                min(m[i][j - 1] + 1, m[i - 1 ][j] + 1))
                    }
                }
                return m[b.length][a.length];
            }

            const UPGMA = (params) => {

                // a few checks on the input parameters
                try {
                    if (
                            // 'labels' and 'distances' are defined
                            !params.labels ||
                            !params.distances ||
                            // the dimensions are consistent
                            params.labels.length !== params.distances.length ||
                            !params.distances.every(row => row.length === params.labels.length) ||
                            // the dimensions are numeric
                            !params.distances.every(row => row.every(value => !isNaN(parseFloat(value)) && isFinite(value))) ||
                            // the dimensions are simmetric
                            (() => { let ok = true;
                                     for(let x = 0; (x < params.distances.length) && ok; x++)
                                         for(let y = 0; (y < params.distances.length) && ok; y ++)
                                             ok = (params.distances[x][y] === params.distances[y][x]);
                                   })()
                        ) throw new Error();
                } catch(e) {
                    throw new Error("The input parameters to the UPGMA algorithm are inconsistent or invalid.");
                }

                let labels = JSON.parse(JSON.stringify(params.labels)),
                    distances = JSON.parse(JSON.stringify(params.distances));

                // makes the labels into arrays, if they aren't already
                labels = labels.map(label => [ ].concat(label));

                // find the minimum and its location
                let minimum = null;
                for (let row = 1; row < distances.length; row++)
                    for (let column = 0; column < row; column++)
                        if (!minimum || distances[minimum.x][minimum.y] > distances[row][column]) minimum = { "x": row, "y": column }

                // prepares the matrix for the next iteration, so that the aggregated
                // labels are in the first position
                let newLabels = JSON.parse(JSON.stringify(labels)),
                    newDistances = JSON.parse(JSON.stringify(distances));
                // remove the aggregated elements from the labels
                newLabels.splice(Math.max(minimum.x, minimum.y), 1);
                newLabels.splice(Math.min(minimum.x, minimum.y), 1);
                // prepend the aggregated labels
                newLabels = [ ].concat([[ labels[minimum.x].concat(labels[minimum.y]).sort() ]], newLabels);
                // remove the aggregated elements from the distances
                newDistances.splice(Math.max(minimum.x, minimum.y), 1);
                newDistances.splice(Math.min(minimum.x, minimum.y), 1);
                newDistances = newDistances.map(row => {
                    row.splice(Math.max(minimum.x, minimum.y), 1);
                    row.splice(Math.min(minimum.x, minimum.y), 1);
                    return row;
                });
                // add to the distances an empty leftmost column
                newDistances = newDistances.map(row => [ 0 ].concat(row));
                // add a empty top row, too
                newDistances = [ (new Array(newDistances[0].length)).fill(0) ].concat(newDistances);

                // creates a quick reference table to the positions in the old distances
                let oldIndeces = [ ];
                for(let i = 0; i < distances[0].length; i++) oldIndeces[i] = i;
                oldIndeces.splice(Math.max(minimum.x, minimum.y), 1);
                oldIndeces.splice(Math.min(minimum.x, minimum.y), 1);

                // calculates the new distances
                // TODO: need to better study the original algorithm: below it is not clear
                //       if the weight takes hierarchy in consideration
                for(let row = 1; row < newDistances.length; row++) {
                    newDistances[row][0] = (
                        labels[minimum.x].length * distances[minimum.x][oldIndeces[row - 1]] +
                        labels[minimum.y].length * distances[minimum.y][oldIndeces[row - 1]]
                    ) / (labels[minimum.x].length + labels[minimum.y].length);
                    newDistances[0][row] = newDistances[row][0];
                }

                return({ "labels": newLabels, "distances": newDistances });
            }

            // clones the input
            tweets = JSON.parse(JSON.stringify(_tweets));
            tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });

            // first clean-up: just drop the exact copies and keep the oldest;
            // the new tweets set also has a "cleaned" property with the text
            // cleaned up of URLs and hashtags
            tweets = consolidateDuplicates(tweets);

            // second clean-up: drop similar tweets

            let labels,
                distances = (new Array(tweets.length)).fill(0).map(row => new Array(tweets.length).fill(0)),
                min_distance = null;

            // calculates the original distances matrix
            labels = tweets.map(t => t.id_str);
            for (let x = 1; x < distances.length; x++)
                for (let y = 0; y < x; y++) {
                    distances[x][y] = levenstein(tweets[x].cleaned, tweets[y].cleaned) / Math.max(tweets[x].cleaned.length, tweets[y].cleaned.length);
                    distances[y][x] = distances[x][y];
                    if (!min_distance || distances[x][y] < min_distance) min_distance = distances[x][y];
                }

            while(min_distance <= tolerance) {
                let results = UPGMA({
                    "labels": labels,
                    "distances": distances
                });
                labels = results.labels;
                distances = results.distances;
                // re-calculate the minimum distance after aggregation
                min_distance = null;
                for (let x = 1; x < distances.length; x++)
                    for (let y = 0; y < x; y++)
                        if (!min_distance || distances[x][y] < min_distance) min_distance = distances[x][y];
            }

            // returns the oldest tweet for each group
            return labels.map(l => [ ].concat(_.flatten(l))).map(l => tweets.filter(t => _.contains(l, t.id_str)).sort((a, b) => a.created_at - b.created_at)[0])
        }

        // NOTE: the order of the cleaning operations is intentional!

        // makes the dates into Date objects
        tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });

        // drops all tweets whose user's screen name (@something) or text
        // match any of the "drop" regular expressions defined in the
        // configuration
        configuration.drops = configuration.drops ? [ ].concat(configuration.drops).map(function (regexpString) { return new RegExp(regexpString, "i"); }) : [ ];
        tweets = tweets.filter(function (t) { return !_.any(configuration.drops, function (regExp) { return t.text.match(regExp) || t.user.screen_name.match(regExp); }); });

        tweets = consolidateDuplicates(tweets);

        // aggregate user "bursts"
        tweets = consolidateTweetBursts(tweets);

        callback(null, tweets);

    }

    const makeFeed = function (configuration, tweets, callback) {
        // sort by created_at, descending
        // TODO: is this necessary?
        tweets.sort(function (a, b) { return b.created_at - a.created_at; });
        if (argv.debug) {
            console.log(JSON.stringify(tweets));
            return callback(null);
        }
        // create the feed
        var feed = new Feed({
            id:      configuration.name,
            title:   "twitter2rss_" + configuration.name,
            link:    'https://github.com/Digital-Contraptions-Imaginarium/twitter2newsbeuter',
            updated: Math.max(_.pluck(tweets, "created_at"))
        });
        tweets.forEach(function (tweet) {
            feed.addItem({
                id: tweet.id_str,
                author: [ {
                            "name": tweet.user.name + " (@" + tweet.user.screen_name + ")",
                            "link": 'https://twitter/' + tweet.user.screen_name
                        } ],
                title:
                    "@"
                    + tweet.user.screen_name
                    + (tweet.text.split("<br>").length > 2 ? " (" + tweet.text.split("<br>").length + ")" : "")
                    + ": " + tweet.text.split("\n")[0],
                description: tweet.text,
                date: tweet.created_at,
                link: "https://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str
            });
        });
        console.log(feed.render('atom-1.0'));
        callback(null);
    }

    t2rShared.getFeedConfiguration(argv._[0], function (err, configuration) {
        if (err) {
            t2rShared.error("Could not read configuration \"" + argv._[0] + "\".");
            return system.exit(1);
        }
        loadTweets(configuration, function (err, tweets) {
            if (err) return callback(err);
            cleanUpTweets(configuration, tweets, function (err, tweets) {
                if (err) return callback(err);
                makeFeed(configuration, tweets, function (err) {
                    if (err) {
                        t2rShared.getLogger().error("Processing of configuration \"" + configuration.name + "\" has failed with error: " + err.message + ".");
                        return callback(err);
                    }
                    t2rShared.getLogger().info("Configuration \"" + configuration.name + "\" processed.");
                });
            });
        });
    });

}

init(main);
