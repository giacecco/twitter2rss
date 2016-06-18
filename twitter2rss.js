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
      // From
      URL_REGEX = new RegExp("(http|ftp|https)://[\w-]+(\.[\w-]*)+([\w.,@?^=%&amp;:/~+#-]*[\w@?^=%&amp;/~+#-])?");

const CONFIG_PATH = path.join(process.env.HOME, ".config", "twitter2rss"),
      DATA_PATH = path.join(process.env.HOME, ".local", "twitter2rss");

var twitterClient;

// Check the Twitter API rate limiting at https://dev.twitter.com/rest/public/rate-limiting)
const twitterSearchLimiter = new Limiter(Math.floor(180 * argv.limiter), 15 * 60000),
      twitterListListLimiter = new Limiter(Math.floor(15  * argv.limiter), 15 * 60000);
      twitterListStatusesLimiter = new Limiter(Math.floor(180  * argv.limiter), 15 * 60000);

const init = function (callback) {
    async.series([
        function (callback) { fs.mkdirs(path.join(CONFIG_PATH, "feeds"), callback); },
        function (callback) { fs.mkdirs(path.join(DATA_PATH, "feeds"), callback); },
        function (callback) {
            fs.readFile(path.join(CONFIG_PATH, 'config'), { 'encoding': 'utf8' }, function (err, text) {
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

            const completed = function () {
                callback(null, configurationFiles);
            }

            if (argv.debug) {
                configurationFiles = [ argv.debug ];
                completed();
            } else {
                fs.readdir(path.join(CONFIG_PATH, "feeds"), function (err, entries) {
                    async.filter(entries, function (entry, callback) {
                        fs.lstat(path.join(CONFIG_PATH, "feeds", entry), function (err, stats) {
                            callback(null, entry.match(/\.json$/) && stats.isFile());
                        });
                    }, function (err, results) {
                        configurationFiles = results.map(function (r) { return path.join(CONFIG_PATH, "feeds", r); });
                        completed();
                    });
                });
            }
        }

        getConfigurationFiles(function (err, entries) {
            if (err || (entries.length === 0)) return callback(err, { });
            var configurations = { };
            async.each(entries, function (entry, callback) {
                fs.readFile(entry, { 'encoding': 'utf8' }, function (err, text) {
                    configurations[path.basename(entry, ".json")] = _.extend({ "name": path.basename(entry, ".json") }, JSON.parse(text));
                    callback(err);
                });
            }, function (err) {
                callback(err, configurations);
            });
        });
    }

    const getStatusesByListNames = function (listNames, callback) {
        listNames = [ ].concat(listNames).map(function (listName) { return listName.toLowerCase(); });
        twitterListListLimiter.removeTokens(1, function() {
            twitterClient.get(
                "lists/list.json",
                // TODO: isn't the line below in the wrong place?
                { "include_rts": argv.retweets ? "true" : undefined },
                function (err, lists, response) {
                    if (err) return callback(err, [ ]);
                    lists = lists.filter(function (l) { return _.contains(listNames, l.name.toLowerCase()) });
                    if (lists.length === 0) return callback(new Error("None of the specified names correspond to existing subscribed lists."), [ ]);
                    async.map(lists, function (list, mapCallback) {
                        twitterListStatusesLimiter.removeTokens(1, function() {
                            twitterClient.get(
                                "lists/statuses.json",
                                { "list_id": list.id_str,
                                  "count": MAX_LIST_COUNT },
                                mapCallback);
                        });
                    }, function (err, results) {
                        if (err) return callback(err, [ ]);
                        results = _.flatten(_.flatten(results, true), true)
                            .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}/) })
                            .filter(function (s) { return argv.replies || !s.text.match(/^@(\w){1,15} /) })
                            .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); });
                        callback(err, results);
                    });
                });
        });
    }

    const getStatusesBySearch = function (searches, callback) {
        searches = [ ].concat(searches);
        async.map(searches, function (search, mapCallback) {
            twitterSearchLimiter.removeTokens(1, function () {
                twitterClient.get(
                    "search/tweets.json",
                    { "q": search,
                      // Note the "result_type" setting below: the ambition is
                      // to avoid any "intelligence" Twitter puts in selecting
                      // what to show me and what not
                      "result_type": "recent",
                      "count": MAX_SEARCH_COUNT },
                    mapCallback);
            });
        }, function (err, results) {
            if (err) return callback(err, [ ]);
            results = _.flatten(_.pluck(_.flatten(results), "statuses"))
                .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}/) })
                .filter(function (s) { return argv.replies || !s.text.match(/^@(\w){1,15} /) })
                .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); });
            callback(err, results);
        });
    }

    const produceAtomFeed = function (configuration, callback) {
        var tweets = [ ];
        async.map([
            { "options": [ ].concat(configuration.lists), "function": getStatusesByListNames },
            { "options": [ ].concat(configuration.searches), "function": getStatusesBySearch },
        ], function (config, callback) {
            async.map(config.options, config.function, function (err, results) {
                callback(err, err ? [ ] : _.flatten(results, true));
            });
        }, function (err, results) {
            tweets = _.flatten(results, true);
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
            // sort by created_at, descending
            tweets.sort(function (a, b) { return b.created_at - a.created_at; });
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
                    title: tweet.text,
                    date: tweet.created_at,
                    link: "https://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str
                });
            });
            argv.debug ? console.log(feed.render('atom-1.0')) : fs.writeFile(path.join(DATA_PATH, "feeds", configuration.name + ".xml"), feed.render('atom-1.0'), { "encoding": "utf8" }, callback);
        });
    }

    const cycle = function (callback) {
        readFeedConfigurations(function (err, configurations) {
            async.each(configurations, produceAtomFeed, callback);
        });
    }

    var loop = true;
    async.whilst(
        function () {
            const okToRun = loop;
            loop = !argv.once;
            return okToRun;
        },
        function (callback) {
            var startTimestamp = (new Date()).valueOf();
            isOnline(function (err, online) {
                if (online) {
                    cycle(function (err) {
                        setTimeout(callback, !loop ? 0 : Math.max(0, startTimestamp + argv.refresh - (new Date()).valueOf()));
                    });
                } else {
                    setTimeout(callback, !loop ? 0 : Math.max(0, startTimestamp + argv.refresh - (new Date()).valueOf()));
                }
            });
        },
        function () { }
    );
}

init(function (err) {
    main();
})
