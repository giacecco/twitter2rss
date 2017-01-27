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
              [--retweets] \
              [--replies] \
              [--urls] \
              [--language iso_639_1_code...] \
          ")
          .default("language", [ "en" ])
          .argv;

// force argv.languages into an array
argv.language = [ ].concat(argv.language);

// From http://stackoverflow.com/a/3809435 + change to support 1-character
// second level domains.
const URL_REGEX = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi);

const
  APPLICATION = {
      LOCAL: "im.dico.twitter2rss",
      NAME: "twitter2rss",
      VERSION: "0.2.0"
  },
  CONFIG_FOLDER = path.join(process.env.HOME, ".local", APPLICATION.LOCAL);

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
                async.map(argv.language, (lang, callback) => {
                    twitter.getSearchTweets({
                        "q": searchString,
                        "lang": lang, //search/tweets allows me to specify a language
                        "count": 100,
                        "resultType": "recent"
                    }, (err, results) => {
                        // TODO: manage error here
                        callback(null, results.statuses);
                    });
                }, (err, r) => {
                    callback(err, _.flatten(r, true));
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
                        // NOTE: the tweets' language cannot be specified in lists/statuses ,
                        //       hence the filtering here
                        callback(null, results);
                    });
                }, (err, r) => {
                    callback(err, results = results.concat(_.flatten(r, true)));
                });
            });
        }
    ], err => {

        // delete duplicates coming from the same tweet being captured by
        // different searches and lists, identified by tweet id
        results = _.uniq(results, r => r.id_str);

        // drop retweets, checks both the metadata and the text
        if (argv.retweets) results = results.filter(s => !s.in_reply_to_status_id_str && !s.text.match(/^rt /i));

        // drop replies, checks both the metadata and the text
        if (argv.retweets) results = results.filter(s => !s.in_reply_to_user_id_str && !s.text.match(/^@/));

        // sort in chronological order
        results.forEach(s => s.created_at = new Date(s.created_at));
        results = results.sort((x, y) => x.created_at - y.created_at);

        // drops messages that differ just by the hashtags or URLs they
        // reference and keep the oldest tweet only
        if (argv.urls) {
            results = _.uniq(results, s => s.text
                // drop the URLs
                .replace(URL_REGEX, "")
                // drop the hashtags
                .replace(/#[\w-]+/g, "")
                // drop all dirty characters and spaces
                .replace(/[^A-Za-z0-9]/g, "")
            );
        }

        // final touches
        results = results
            // filter for the required languages
            .filter(s => _.contains(argv.language, s.lang));

        console.log(results.map(s => s.text).join("\n"));
    });
});
