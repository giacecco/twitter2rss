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
      TWEET_BURST = 180000,
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

            tweets = JSON.parse(JSON.stringify(_tweets));
            tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });
            // SOMETHING HERE!
            // There must be an algorithm to do this properly, see
            // http://stats.stackexchange.com/questions/2717/clustering-with-a-distance-matrix
            // and https://en.wikipedia.org/wiki/UPGMA
            var distances = new Array(tweets.length, tweets.length);
            for (var x = 0; x < tweets.length - 1; x++)
                for (var y = x + 1; y < tweets.length; y++) {
                    const score = levenstein(tweets[x].text, tweets[y].text) / Math.max(tweets[x].text.length, tweets[y].text.length);
                    distances[x][y] = score;
                    distances[y][x] = score;
                }


            return tweets;
        }

        // NOTE: the order of the cleaning operations is intentional!

        // makes the dates into Date objects
        tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });

        // drops all tweets whose user's screen name (@something) or text
        // match any of the "drop" regular expressions defined in the
        // configuration
        configuration.drops = configuration.drops ? [ ].concat(configuration.drops).map(function (regexpString) { return new RegExp(regexpString, "i"); }) : [ ];
        tweets = tweets.filter(function (t) { return !_.any(configuration.drops, function (regExp) { return t.text.match(regExp) || t.user.screen_name.match(regExp); }); });

        // identifies tweets whose text is identical but by the hashtags and
        // URLs they include, and keeps the oldest only
        tweets = _.values(tweets.reduce((memo, t) => {
            const cleaned = t.text
                .replace(URL_REGEX, "")
                .replace(/#[\w-]+/g, "")
                .replace(/\s\s+/, " "); // see http://stackoverflow.com/a/1981366
            memo[cleaned] = !memo[cleaned] ? t : (memo[cleaned].created_at < t.created_at ? memo[cleaned] : t);
            return memo;
        }, { }));

        // tweets = consolidateAlmostDuplicates(tweets, .5);

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
