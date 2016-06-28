const async = require("async"),
      Feed = require('feed'),
      fs = require("fs-extra"),
      // https://github.com/sindresorhus/is-online
      // overkill?
      isOnline = require('is-online'),
      // https://github.com/jhurliman/node-rate-limiter
      Limiter = require('limiter').RateLimiter,
      path = require("path"),
      // https://github.com/desmondmorris/node-twitter
      Twitter = require("twitter"),
      _ = require("underscore"),
      argv = require('yargs')
          .usage('Usage: $0 [--debug feed_configuration_file] [--once] [--refresh refresh_rate_in_minutes] [--retweets] [--replies] [--language iso_639_1_code...] [--limiter perc_of_max_rate]')
          .default("refresh", "15")
          .default("limiter", "90")
          .default("language", [ "en" ])
          .argv;

argv.refresh = parseFloat(argv.refresh) * 60000;
argv.limiter = Math.min(1.0, parseFloat(argv.limiter) / 100.0);
if (argv.debug) argv.once = true;

const MAX_LIST_COUNT = 1000, // No. of max tweets to fetch, before filtering
                             // by language.
                             // NOTE: I haven't checked if there is a limit to
                             // this, but it definitely can return more than 100
                             // statuses.
      MAX_SEARCH_COUNT = 100, // No. of max tweets to fetch, before filtering by
                              // language.
                              // NOTE: apparently anything more than 100 is
                              // ignored.
      // A Twitter burst is defined by two tweets being published at most this
      // close (milliseconds)
      TWEET_BURST = 180000,
      // From ?
      URL_REGEX = new RegExp("(http|ftp|https)://[\w-]+(\.[\w-]*)+([\w.,@?^=%&amp;:/~+#-]*[\w@?^=%&amp;/~+#-])?");

const CONFIG_PATH = path.join(process.env.HOME, ".config", "twitter2rss"),
      DATA_PATH = path.join(process.env.HOME, ".local", "twitter2rss");

var twitterClient;

// Check the Twitter API rate limiting at https://dev.twitter.com/rest/public/rate-limiting)
const twitterSearchLimiter = new Limiter(Math.floor(180 * argv.limiter), 15 * 60000),
      twitterListLimiter = new Limiter(Math.floor(15  * argv.limiter), 15 * 60000);

const init = function (callback) {
    async.series([
        function (callback) { fs.mkdirs(path.join(CONFIG_PATH, "feeds"), callback); },
        function (callback) { fs.mkdirs(path.join(DATA_PATH, "feeds"), callback); },
        function (callback) {
            fs.readFile(path.join(CONFIG_PATH, 'config'), { 'encoding': 'utf8' }, function (err, text) {
                if (err) return callback(err);
                twitterClient = new Twitter(JSON.parse(text).twitter);
                callback(null);
            });
        }
    ], callback);
}

const main = function (callback) {

    const readFeedConfigurations = function (callback) {

        const getConfigurationFiles = function (callback) {
            var configurationFiles;
            if (argv.debug) {
                configurationFiles = [ argv.debug ];
                return callback(null, configurationFiles);
            } else {
                fs.readdir(path.join(CONFIG_PATH, "feeds"), function (err, entries) {
                    async.filter(entries, function (entry, callback) {
                        fs.lstat(path.join(CONFIG_PATH, "feeds", entry), function (err, stats) {
                            callback(null, entry.match(/\.json$/) && stats.isFile());
                        });
                    }, function (err, results) {
                        if (err) return callback(err);
                        configurationFiles = results.map(function (r) { return path.join(CONFIG_PATH, "feeds", r); });
                        callback(null, configurationFiles);
                    });
                });
            }
        }

        getConfigurationFiles(function (err, entries) {
            if (err) return callback(err);
            if (entries.length === 0) callback(new Error("No configuration files found."));
            var configurations = { };
            async.each(entries, function (entry, callback) {
                fs.readFile(entry, { 'encoding': 'utf8' }, function (err, text) {
                    if (err) return callback(err);
                    configurations[path.basename(entry, ".json")] = _.extend({ "name": path.basename(entry, ".json") }, JSON.parse(text));
                    callback(null);
                });
            }, function (err) {
                callback(err, configurations);
            });
        });
    }

    // Note this function is memoised to cache its results for 10 minutes
    const getAllLists = async.memoize(function (callback) {
        twitterListLimiter.removeTokens(1, function() {
            twitterClient.get(
                "lists/list.json",
                // TODO: isn't the line below in the wrong place?
                { "include_rts": argv.retweets ? "true" : undefined },
                function (err, lists, response) {
                    if (err) return response;
                    if (err) return callback(err);
                    callback(null, lists);
                });
        });
    }, function () { return Math.floor((new Date()).valueOf() / (argv.refresh * 60000)); });

    // Returns an array of Twitter list objects whose names are included in
    // _listNames_ (case-insensitive). The array is empty if no matching name
    // could be found.
    const getListsByListNames = function (listNames, callback) {
        listNames = [ ].concat(listNames).map(function (listName) { return listName.toLowerCase(); });
        getAllLists(function (err, lists) {
            if (err) return callback(err);
            lists = lists.filter(function (l) { return _.contains(listNames, l.name.toLowerCase()) });
            callback(null, lists);
        });
    }

    // Returns an array of the max possible number of Twitter statuses from all
    // Twitter lists whose names are included in _list_names. Each list provides
    // a max of _MAX_LIST_COUNT_ statuses.
    const getStatusesByListNames = async.memoize(function (listNames, callback) {
        listNames = [ ].concat(listNames).map(function (listName) { return listName.toLowerCase(); });
        if (listNames.length > 1) {
            async.map(listNames, getStatusesByListNames, function (err, results) {
                callback(err, err ? null : _.flatten(results, true));
            });
        } else {
            getListsByListNames(listNames[0], function (err, list) {
                if (err) return callback(err);
                if (list.length < 1) return callback (new Error("List \"" + listName[0] + "\" could not be found.\""));
                list = list[0];
                twitterListLimiter.removeTokens(1, function() {
                    twitterClient.get(
                        "lists/statuses.json",
                        { "list_id": list.id_str,
                          "count": MAX_LIST_COUNT },
                          function (err, results, response) {
                              if (err) return response;
                              callback(err, err ? null :
                                  results
                                      .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}/) })
                                      .filter(function (s) { return argv.replies || !s.text.match(/^@(\w){1,15} /) })
                                      .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); })
                              );
                          });
                });
            });
        }
    }, function (listNames) { return JSON.stringify(listNames) + "_" + Math.floor((new Date()).valueOf() / (argv.refresh * 60000)); });

    const getStatusesBySearch = async.memoize(function (searches, callback) {
        searches = [ ].concat(searches);
        if (searches.length > 1) {
            async.map(searches, getStatusesBySearch, function (err, results) {
                callback(err, err ? null : _.pluck(_.flatten(results, true), "statuses"));
            });
        } else {
            twitterSearchLimiter.removeTokens(1, function () {
                twitterClient.get(
                    "search/tweets.json",
                    { "q": searches[0],
                      // Note the "result_type" setting below: the ambition is
                      // to avoid any "intelligence" Twitter puts in selecting
                      // what to show me and what not
                      "result_type": "recent",
                      "count": MAX_SEARCH_COUNT },
                    function (err, results, response) {
                        if (err) return response;
                        callback(err, err ? null :
                            results.statuses
                                .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}/) })
                                .filter(function (s) { return argv.replies || !s.text.match(/^@(\w){1,15} /) })
                                .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); })
                        );
                    });
            });
        }
    }, function (searches) { return JSON.stringify(searches) + "_" + Math.floor((new Date()).valueOf() / (argv.refresh * 60000)); });

    const fetchTweets = function (configuration, callback) {
        async.map([
            { "options": [ ].concat(configuration.lists), "function": getStatusesByListNames },
            { "options": [ ].concat(configuration.searches), "function": getStatusesBySearch },
        ], function (config, callback) {
            async.map(config.options, config.function, function (err, results) {
                callback(err, err ? [ ] : _.flatten(results, true));
            });
        }, function (err, results) {
            callback(err, err ? [ ] : _.flatten(results, true));
        });
    }

    const cleanUpTweets = function (configuration, tweets, callback) {

        const bucketTweetsByTime = function (tweets, lapse) {
            tweets.sort(function (a, b) { return a.created_at - b.created_at; });
            var results = [ ];
            tweets.forEach(function (e) {
                var grouped = false;
                for (var i = 0; !grouped && (i < results.length); i++) {
                    if (_.some(results[i], function (f) {
                        return Math.abs(e.created_at - f.created_at) <= lapse;
                    })) {
                        grouped = true;
                        results[i] = results[i].concat(e);
                    }
                }
                if (!grouped) results = results.concat([[ e ]]);
            });
            return results;
        }

        // drops all tweets that match any of the "drop" regular expressions
        // defined in the configuration
        configuration.drops = configuration.drops ? [ ].concat(configuration.drops).map(function (regexpString) { return new RegExp(regexpString); }) : [ ];
        tweets = tweets.filter(function (t) { return !_.any(configuration.drops, function (regExp) { return t.text.match(regExp); }); });
        // removes duplicate ids
        tweets = _.uniq(tweets, function (s) { return s.id_str; });
        // removes duplicate content, and keeps the oldest identical tweet
        // TODO: is this really useful?
        tweets = _.uniq(_.pluck(tweets, "text").map(function (t) { return t.replace(URL_REGEX, ""); }))
            .map(function (text) {
                return _.first(tweets.filter(function (tweet) { return tweet.text.replace(URL_REGEX, "") === text; }).sort(function (a, b) { return a.created_at - b.created_at; }));
            });
        // makes the dates into Date objects
        tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });
        // aggregate user "bursts"
        tweets = _.flatten(_.uniq(_.pluck(_.pluck(tweets, "user"), "screen_name")).map(function (screenName) {
            return tweets.filter(function (t) { return t.user.screen_name === screenName; });
        }).map(function (userTweets) {
            return bucketTweetsByTime(userTweets, TWEET_BURST).map(function (tweetsGroup) {
                var newTweet = tweetsGroup[0];
                for (var i = 1; i < tweetsGroup.length; i++)
                    newTweet.text += (
                        "<br>" +
                        ("0" + tweetsGroup[i].created_at.getHours()).slice(-2) +
                        ":" +
                        ("0" + tweetsGroup[i].created_at.getMinutes()).slice(-2) +
                        " - " +
                        tweetsGroup[i].text
                    );
                return newTweet;
            });
        }), true);
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
        fs.writeFile(
            path.join(DATA_PATH, "feeds", configuration.name + ".xml"),
            feed.render('atom-1.0'), { "encoding": "utf8" },
            callback);
    }

    const cycle = function (callback) {
        readFeedConfigurations(function (err, configurations) {
            if (err) return callback(err);
            async.each(configurations, function (configuration, callback) {
                fetchTweets(configuration, function (err, tweets) {
                    if (err) return callback(err);
                    cleanUpTweets(configuration, tweets, function (err, tweets) {
                        if (err) return callback(err);
                        makeFeed(configuration, tweets, callback);
                    });
                });
            }, function (err) {
                if (err) {
                    console.log("Cycle interrupted by error \"" + err.message + "\".");
                    return process.exit(1);
                }
                callback(null);
            });
        });
    }

    async.doWhilst(
        function (callback) {
            var startTimestamp = (new Date()).valueOf();
            isOnline(function (err, online) {
                const waitAndNextCycle = function () { setTimeout(callback, argv.once ? 0 : Math.max(0, startTimestamp + argv.refresh - (new Date()).valueOf())); }
                if (!err && online) { cycle(waitAndNextCycle) } else { waitAndNextCycle(); }
            });
        },
        function () { return !argv.once; },
        function () { } // this is never run unless argv.once
    );
}

init(function (err) {
    if (err) {
        console.log("Initialisation failed.");
        return process.exit(1);
    }
    main();
});
