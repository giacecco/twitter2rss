const async = require("async"),
      fs = require("fs-extra"),
      // https://github.com/jhurliman/node-rate-limiter
      Limiter = require('limiter').RateLimiter,
      path = require("path"),
      // https://github.com/mapbox/node-sqlite3
      sqlite3 = require('sqlite3').verbose(),
      // https://github.com/desmondmorris/node-twitter
      Twitter = require("twitter"),
      _ = require("underscore"),
      argv = require('yargs')
          .usage("Usage: $0 \
              [--debug path_to_feed_configuration_file] \
              [--loglevel] \
              [--once] \
              [--refresh refresh_rate_in_minutes] \
              [--retweets] \
              [--replies] \
              [--language iso_639_1_code...] \
              [--limiter perc_of_max_rate] \
          ")
          .default("loglevel", "error")
          .default("refresh", "15")
          .default("limiter", "90")
          .default("language", [ "en" ])
          .argv;

const t2rShared = new require("./twitter2rss-shared")();

const MAX_CACHE_AGE = 365, // the default max number of days tweets are kept
      MAX_LIST_COUNT = 1000, // No. of max tweets to fetch, before filtering
                             // by language.
                             // NOTE: I haven't checked if there is a limit to
                             // this, but it definitely can return more than 100
                             // statuses.
      MAX_SEARCH_COUNT = 100; // No. of max tweets to fetch, before filtering by
                              // language.
                              // NOTE: apparently anything more than 100 is
                              // ignored.

// the global variables... too many?S
var twitterClient,
    twitterSearchLimiter,
    twitterListLimiter;

const init = function (callback) {

    async.series([

        // shared functionality initialisation
        function (callback) {
            t2rShared.init(argv, callback);
        },

        // various operational parameters Initialisation
        function (callback) {

            // argv.refresh is the minimum time in milliseconds between two full refreshes
            // of all feeds; note only one refresh takes place at any one time
            argv.refresh = parseFloat(argv.refresh) * 60000;

            // Check the Twitter API rate limiting at https://dev.twitter.com/rest/public/rate-limiting)
            argv.limiter = Math.min(1.0, parseFloat(argv.limiter) / 100.0);
            twitterSearchLimiter = new Limiter(Math.floor(180 * argv.limiter), 15 * 60000);
            twitterListLimiter = new Limiter(Math.floor(15  * argv.limiter), 15 * 60000);

            // if debug mode is enabled, the cycle will run only once
            if (argv.debug) argv.once = true;

            callback(null);
        },

        // Twitter client initialisation
        function (callback) {
            twitterClient = new Twitter(t2rShared.getConfiguration().twitter);
            callback(null);
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

    // Note this function is memoised to cache its results for 10 minutes
    const getAllLists = async.memoize(function (callback) {
        twitterListLimiter.removeTokens(1, function() {
            t2rShared.getLogger().info("Querying Twitter API for metadata about all lists...");
            twitterClient.get(
                "lists/list.json",
                // TODO: isn't the line below in the wrong place?
                { "include_rts": argv.retweets ? "true" : undefined },
                function (err, lists, response) {
                    if (err) {
                        t2rShared.getLogger().error("Failed querying Twitter API for metadata about all lists, with error message: " + err.message);
                        return system.exit(1);
                    }
                    t2rShared.getLogger().info("Querying Twitter API for metadata about all lists completed.");
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
                    t2rShared.getLogger().info("Querying Twitter API for statuses in list \"" + list.name + "\"...");
                    twitterClient.get(
                        "lists/statuses.json",
                        { "list_id": list.id_str,
                          "count": MAX_LIST_COUNT },
                          function (err, results, response) {
                              if (err) {
                                  t2rShared.getLogger().error("Querying Twitter API for statuses in list \"" + list.name + "\" failed with error message: " + err.message);
                                  return process.exit(1);
                              }
                              results = results
                                  .filter(function (s) { return argv.retweets ||   !s.text.match(/^RT @(\w){1,15}/) })
                                  .filter(function (s) { return argv.replies || !s.text.match(/^@(\w){1,15} /) })
                                  .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); });
                              t2rShared.getLogger().info("Querying Twitter API for statuses in list \"" + list.name + "\" completed.");
                              callback(null,  results);
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
                t2rShared.getLogger().info("Querying Twitter API for search \"" + searches[0] + "\"...");
                twitterClient.get(
                    "search/tweets.json",
                    { "q": searches[0],
                      // Note the "result_type" setting below: the ambition is
                      // to avoid any "intelligence" Twitter puts in selecting
                      // what to show me and what not
                      "result_type": "recent",
                      "count": MAX_SEARCH_COUNT },
                    function (err, results, response) {
                        if (err) {
                            // TODO: need to avoid quitting for errors such as
                            //       503 (service unavailable) https://dev.twitter.com/overview/api/response-codes
                            t2rShared.getLogger().error("Querying Twitter API for search \"" + searches[0] + "\" failed with error message: " + err.message + ", full response is " + JSON.stringify(response) + ".");
                            return process.exit(1);
                        }
                        results = results.statuses
                            .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}/) })
                            .filter(function (s) { return argv.replies || !s.text.match(/^@(\w){1,15} /) })
                            .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); })
                        t2rShared.getLogger().info("Querying Twitter API for search \"" + searches[0] + "\" completed.");
                        callback(err, results);
                    });
            });
        }
    }, function (searches) { return JSON.stringify(searches) + "_" + Math.floor((new Date()).valueOf() / (argv.refresh * 60000)); });

    const fetchTweets = function (configuration, callback) {

        // this function adds any new tweets to the archive
        const saveTweets = function (configuration, tweets, callback) {

            const createOrOpenDb = function (callback) {
                fs.stat(sqliteFilename, function (err, stat) {
                    var newDb = !!err;
                    var db = new sqlite3.Database(sqliteFilename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, function (err) {
                        if (err) {
                            t2rShared.getLogger().error("Error opening the sqlite3 cache for configuration " + configuration.name + ". Error message is: " + err.message);
                            return process.exit(1);
                        }
                        if (!newDb) return callback(null, db);
                        db.run("CREATE TABLE tweets (id TEXT, payload JSON, UNIQUE(id));", { }, function (err) {
                            if (err) {
                                t2rShared.getLogger().error("Error initialising the sqlite3 cache for configuration " + configuration.name + ". Error message is: " + err.message);
                                return process.exit(1);
                            }
                            t2rShared.getLogger().info("Initialised the sqlite3 cache for configuration " + configuration.name + ".");
                            callback(null, db);
                        });
                    });
                });
            }

            var sqliteFilename = path.join(t2rShared.getDataPath(), "feeds", configuration.name + ".sqlite3");
            createOrOpenDb(function (err, db) {
                async.eachSeries(tweets, function (tweet, callback) {
                    db.run("INSERT OR IGNORE INTO tweets (id, payload) VALUES ($id, json($payload));", {
                        "$id": tweet.id,
                        "$payload": JSON.stringify(tweet)
                    }, callback);
                }, function (err) {
                    if (err) {
                        t2rShared.getLogger().error("Error inserting tweet into cache: " + err.message);
                        return process.exit(1);
                    }
                    // garbage collect
                    db.run("delete from tweets where julianday('now') - julianday(datetime(substr(json_extract(payload, '$.created_at'), 27, 4) || '-' || case substr(json_extract(payload, '$.created_at'), 5, 3) when 'Jan' then '01' when 'Feb' then '02' when 'Mar' then '03' when 'Apr' then '04' when 'May' then '05' when 'Jun' then '06' when 'Jul' then '07' when 'Aug' then '08' when 'Sep' then '09' when 'Oct' then '10' when 'Nov' then '11' when 'Dec' then '12' end || '-' || substr(json_extract(payload, '$.created_at'), 9, 2) || ' ' || substr(json_extract(payload, '$.created_at'), 12, 2) || ':' || substr(json_extract(payload, '$.created_at'), 15, 2) || ':' || substr(json_extract(payload, '$.created_at'), 18, 2))) > $maxCacheAge;", { "$maxCacheAge": configuration.archive ? parseInt(configuration.archive.max_age || MAX_CACHE_AGE) : MAX_CACHE_AGE }, function (err) {
                        if (err) {
                            t2rShared.getLogger().error("Error garbage-collecting the cache: " + err.message);
                            return process.exit(1);
                        }
                        db.close(function (err) {
                            callback(err, tweets);
                        });
                    });
                });
            });
        }

        async.map([
            { "options": configuration.lists ? [ ].concat(configuration.lists) : [ ], "function": getStatusesByListNames },
            { "options": configuration.searches ? [ ].concat(configuration.searches) : [ ], "function": getStatusesBySearch },
        ], function (config, callback) {
            async.map(config.options, config.function, function (err, results) {
                callback(err, err ? [ ] : _.flatten(results, true));
            });
        }, function (err, results) {
            if (err) return callback(err, [ ]);
            results = _.flatten(results, true);
            // removes duplicate ids (e.g. the same tweet could come out in a
            // list and a search)
            results = _.uniq(results, false, function (s) { return s.id_str; });
            saveTweets(configuration, results, callback);
        });
    }

    const cycle = function (callback) {
        t2rShared.getLogger().info("Starting a new cycle...");
        t2rShared.getFeedConfigurations(function (err, configurations) {
            if (err) return callback(err);
            async.eachSeries(configurations, function (configuration, callback) {
                t2rShared.getLogger().info("Processing configuration \"" + configuration.name + "\"...");
                fetchTweets(configuration, callback);
            },  function (err) {
                if (err) {
                    t2rShared.getLogger().error("Cycle interrupted by error in processing one ore more configurations.");
                    return process.exit(1);
                }
                t2rShared.getLogger().info("The cycle is complete.");
                callback(null);
            });
        });
    }

    var startTimestamp = null;
    async.doWhilst(
        callback => {
            const now = (new Date()).valueOf();
            if (startTimestamp && (now - startTimestamp < argv.refresh)) return setTimeout(callback, 1000);
            startTimestamp = now;
            t2rShared.isOnline(online => {
                console.log("Am I here 3? " + online);
                if (!online) {
                    t2rShared.getLogger().info("The network is down or the component checking for connectivity returned an error.")
                    return callback(null);
                }
                return cycle(callback)
            });
        },
        () => !argv.once,
        () => { }
    );

}

init(main);
