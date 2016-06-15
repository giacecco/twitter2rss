const async = require("async"),
      Feed = require('feed'),
      fs = require("fs-extra"),
      // https://github.com/sindresorhus/is-online
      // overkill?
      isOnline = require('is-online'),
      // https://github.com/jhurliman/node-rate-limiter
      Limiter = require('limiter').RateLimiter,
      path = require("path"),
      Twitter = require("twitter"),
      _ = require("underscore"),
      argv = require('yargs')
          .usage('Usage: $0 [--refresh refresh_rate_in_minutes] [--retweets] [--language iso_639_1_code...] [--limiter perc_of_max_rate]')
          .default("refresh", "15")
          .default("limiter", "100")
          .default("language", [ "en" ])
          .argv;

argv.refresh = parseFloat(argv.refresh) * 60000;
argv.limiter = parseFloat(argv.limiter) / 100.0;

const MAX_LIST_COUNT = 1000, // No. of max tweets to fetch, before filtering
                             // by language.
                             // NOTE: I haven't checked if there is a limit to
                             // this, but it definitely can return more than 100
                             // statuses.
      MAX_SEARCH_COUNT = 100; // No. of max tweets to fetch, before filtering by
                              // language.
                              // NOTE: apparently anything more than 100 is
                              // ignored.

const CONFIG_PATH = path.join(process.env.HOME, ".config", "twitter2newsbeuter"),
      DATA_PATH = path.join(process.env.HOME, ".local", "twitter2newsbeuter");

var twitterClient;

// Check the Twitter API rate limiting at https://dev.twitter.com/rest/public/rate-limiting)
const twitterSearchLimiter = new Limiter(180 * argv.limiter, 15 * 60000),
      twitterReadLimiter = new Limiter(15  * argv.limiter, 15 * 60000);

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

    const getStatusesByListName = function (name, callback) {
        twitterReadLimiter.removeTokens(1, function() {
            twitterClient.get("lists/list.json", { }, function(err, lists, response) {
                if (err) return callback(err, [ ]);
                var list = lists.find(function (l) { return l.name.toLowerCase() === name.toLowerCase(); });
                if (!list) return callback(new Error("The specified list does not exist."));
                twitterClient.get("lists/statuses.json", { "list_id": list.id_str, "count": MAX_LIST_COUNT }, function(err, statuses, response) {
                    // keeping only tweets in the requested languages
                    statuses = statuses
                        .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}: /) })
                        .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); });
                    callback(err, _.extend(list, { "statuses": statuses }));
                });
            });
        });
    }

    const getStatusesBySearch = function (search, callback) {
        twitterSearchLimiter.removeTokens(1, function () {
            // Note the "result_type" setting below: the ambition is to avoid any
            // "intelligence" Twitter puts in selecting what to show me and what not
            twitterClient.get("search/tweets.json", { "q": search, "result_type": "recent", "count": MAX_SEARCH_COUNT }, function(err, results, response) {
                if (err) return callback(err, [ ]);
                // keeping only tweets in the requested languages
                results.statuses = results.statuses
                    .filter(function (s) { return argv.retweets || !s.text.match(/^RT @(\w){1,15}: /) })
                    .filter(function (s) { return _.contains([ ].concat(argv.language), s.lang); });
                callback(err, results);
            });
        });
    }

    const readFeedConfigurations = function (callback) {
        fs.readdir(path.join(CONFIG_PATH, "feeds"), function (err, entries) {
            async.filter(entries, function (entry, callback) {
                fs.lstat(path.join(CONFIG_PATH, "feeds", entry), function (err, stats) {
                    callback(null, entry.match(/\.json$/) && stats.isFile());
                });
            }, function (err, entries) {
                var configurations = { };
                async.each(entries, function (entry, callback) {
                    fs.readFile(path.join(CONFIG_PATH, "feeds", entry), { 'encoding': 'utf8' }, function (err, text) {
                        configurations[path.basename(entry, ".json")] = _.extend({ "name": path.basename(entry, ".json") }, JSON.parse(text));
                        callback(err);
                    });
                }, function (err) {
                    callback(err, configurations);
                });
            });
        });
    }

    const produceAtomFeed = function (configuration, callback) {
        var tweets = [ ];
        async.map([
            { "options": [ ].concat(configuration.lists), "function": getStatusesByListName },
            { "options": [ ].concat(configuration.searches), "function": getStatusesBySearch },
        ], function (config, callback) {
            async.map(config.options, config.function, function (err, results) {
                callback(err, err ? [ ] : _.flatten(_.pluck(results, "statuses"), true));
            });
        }, function (err, results) {
            tweets = _.flatten(results, true);
            // removes duplicate ids
            tweets = _.uniq(tweets, function (s) { return s.id_str; });
            // removes duplicate content, and keeps the oldest identical tweet
            // TODO: is this really useful?
            tweets = _.uniq(_.pluck(tweets, "text")).map(function (text) {
                return _.first(tweets.filter(function (tweet) { return tweet.text === text; }).sort(function (a, b) { return a.created_at - b.created_at; }));
            });
            // makes the dates into Date objects
            tweets.forEach(function (s) { s.created_at = new Date(s.created_at); });
            // sort by created_at, descending
            tweets.sort(function (a, b) { return b.created_at - a.created_at; });
            // create the feed
            var feed = new Feed({
                id:      configuration.name,
                title:   "twitter2newsbeuter_" + configuration.name,
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
            fs.writeFile(path.join(DATA_PATH, "feeds", configuration.name + ".xml"), feed.render('atom-1.0'), { "encoding": "utf8" }, callback);
        });
    }

    const cycle = function (callback) {
        readFeedConfigurations(function (err, configurations) {
            async.each(configurations, produceAtomFeed, callback);
        });
    }

    async.whilst(
        function () { return true; },
        function (callback) {
            var startTimestamp = (new Date()).valueOf();
            isOnline(function (err, online) {
                if (online) {
                    cycle(function (err) {
                        setTimeout(callback, Math.max(0, startTimestamp + argv.refresh - (new Date()).valueOf()));
                    });
                } else {
                    setTimeout(callback, Math.max(0, startTimestamp + argv.refresh - (new Date()).valueOf()));
                }
            });
        },
        function () { }
    );
}

init(function (err) {
    main();
})
