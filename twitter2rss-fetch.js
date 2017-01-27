const async = require("async"),
      fs = require("fs-extra"),
      path = require("path"),
      // https://github.com/mapbox/node-sqlite3
      // custom open source licence
      sqlite3 = require('sqlite3').verbose(),
      // https://github.com/Digital-Contraptions-Imaginarium/t2
      // MIT license
      T2 = require("im.dico.t2").Twitter,
      _ = require("underscore"),
      argv = require('yargs')
          .usage("Usage: $0 \
              [--debug path_to_feed_configuration_file] \
              [--once] \
              [--refresh refresh_rate_in_minutes] \
              [--retweets] \
              [--replies] \
              [--language iso_639_1_code...] \
              [--limiter perc_of_max_rate] \
          ")
          .default("refresh", "15")
          .default("language", [ "en" ])
          .argv;

var twitter = new T2({
  "consumerkey": argv.consumerkey ? argv.consumerkey : process.env.TWITTER2RSS_CONSUMER_KEY,
  "consumersecret": argv.consumersecret ? argv.consumersecret : process.env.TWITTER2RSS_CONSUMER_SECRET,
  "tokenkey": argv.tokenkey ? argv.tokenkey : process.env.TWITTER2RSS_ACCESS_TOKEN_KEY,
  "tokensecret": argv.tokensecret ? argv.tokensecret : process.env.TWITTER2RSS_ACCESS_TOKEN_SECRET
});

var configuration = argv.debug;
fs.readFile(configuration, { "encoding": "utf8" }, (err, text) => {
    if (err) {
        console.error("Error reading configuration file " + configurationFile + " with error " + err.message);
        system.exit(1);
    }
    configuration = JSON.parse(text);
    var results = [ ];
    async.parallel([
        callback => {
            // all the searches
            async.map(configuration.searches, (searchString, callback) => {
                twitter.getSearchTweets({
                    "q": searchString,
                    "lang": "en",
                    "count": 100,
                    "resultType": "recent"
                }, (err, results) => {
                    // TODO: manage error here
                    callback(null, results.statuses);
                });
            }, (err, r) => {
                callback(err, results = results.concat(_.flatten(r, true)));
            });
        },
        callback => {
            // all the lists
            twitter.getListsList((err, lists) => {
                // TODO: manage error here
                lists = lists.reduce((memo, list) => memo.concat(_.contains(configuration.lists, list.name) ? list.id_str : [ ]), [ ]);
                async.map(lists, (listId, callback) => {
                    twitter.getListsStatuses({
                        "list_id": listId,
                        "count": 100 // not clear if there's a max here
                    }, (err, results) => {
                        // TODO: manage error here
                        callback(null, results);
                    });
                }, (err, r) => {
                    callback(err, results = results.concat(_.flatten(r, true)));
                });
            });
        }
    ], err => {
        // delete duplicates and sort in reverse chronological order
        results = _.uniq(results, r => r.id_str).sort((x, y) => (new Date(x.created_at) - new Date(y.created_at)));
        console.log(JSON.stringify(results));
    });
});
