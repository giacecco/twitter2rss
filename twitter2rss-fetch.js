const async = require("async"),
      fs = require("fs-extra"),
      path = require("path"),
      // https://github.com/Digital-Contraptions-Imaginarium/t2
      // MIT license
      T2 = require("im.dico.t2").Twitter,
      twitter2RssShared = require("./twitter2rss-shared"),
      _ = require("underscore"),
      argv = require('yargs')
          // TODO: at the moment, this is never displayed
          .usage("Usage: $0 \
              [configuration_file] \
              [--retweets] \
              [--replies] \
              [--noise] \
              [--nocache] \
              [--language iso_639_1_code...] \
              [--post] \
          ")
          .argv;

const fileExistsSync = f => {
    // TODO if the original from the *fs* library was deprecated there must be a reason...
    var ok = true; try { fs.statSync(f); } catch (err) { ok = false; }; return ok;
}

const
  APPLICATION = {
      LOCAL: "im.dico.twitter2rss",
      NAME: "twitter2rss",
      VERSION: "0.1.10"
  },
  CONFIG_FOLDER = path.join(process.env.HOME, ".local", APPLICATION.LOCAL);

var twitter = new T2({
    "local": path.join(process.env.HOME, ".local", APPLICATION.LOCAL, "t2"),
    "consumerkey": argv.consumerkey ? argv.consumerkey : process.env.TWITTER2RSS_CONSUMER_KEY,
    "consumersecret": argv.consumersecret ? argv.consumersecret : process.env.TWITTER2RSS_CONSUMER_SECRET,
    "tokenkey": argv.tokenkey ? argv.tokenkey : process.env.TWITTER2RSS_ACCESS_TOKEN_KEY,
    "tokensecret": argv.tokensecret ? argv.tokensecret : process.env.TWITTER2RSS_ACCESS_TOKEN_SECRET,
    "nocache": argv.nocache
});

let configuration = twitter2RssShared.readConfiguration(argv);

// does the job
let tweets = [ ];
async.parallel([
    callback => {
        // all the searches
        async.map(configuration.searches, (searchString, callback) => {
            async.map(configuration.languages, (lang, callback) => {
                twitter.getSearchTweets({
                    "q": searchString,
                    "lang": lang, //search/tweets allows me to specify a language
                    "count": 100,
                    "resultType": "recent"
                }, (err, results) => {
                    // NOTE: we are resilent to errors from T2, however this
                    //       won't help debugging any issues
                    callback(null, err ? [ ] : results.statuses);
                });
            }, (err, r) => {
                callback(err, _.flatten(r, true));
            });
        }, (err, r) => {
            if (!err) tweets = tweets.concat(_.flatten(r, true));
            callback(err);
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
                    // NOTE: we are resilent to errors from T2, however this
                    //       won't help debugging any issues
                    callback(null, err ? [ ] : results);
                });
            }, (err, r) => {
                if (!err) tweets = tweets.concat(_.flatten(r, true));
                callback(err);
            });
        });
    }
], err => {

    // restore the dates
    tweets.forEach(s => s.created_at = new Date(s.created_at));

    // delete duplicates coming from the same tweet being captured by
    // different searches and lists, identified by tweet id
    tweets = _.uniq(tweets, r => r.id_str);

    tweets = twitter2RssShared.allFilters(
        tweets,
        {
            "drops": configuration.drops,
            "retweets": configuration.retweets,
            "replies": configuration.replies,
            "noise": configuration.noise,
            "languages": configuration.languages
        }
    );

    // --post directives and output
    // NOTE: this is the same code as in t2cli.json in
    //       Digital-Contraptions-Imaginarium/t2
    async.reduce(!argv.post ? [ "x => JSON.stringify(x)" ] : [ ].concat(argv.post), tweets, (memo, p, callback) => {
        p = eval(fileExistsSync(p) ? fs.readFileSync(p, { "encoding": "utf8" }) : p);
        if (p.length > 1) {
            // the --post function is asynchronous
            return p(memo, callback);
        } else {
            // the --post function is synchronous
            callback(null, p(memo));
        }
    }, (err, tweets) => {
        if (err) {
            console.error("Undefined error in executing the --post commands.");
            process.exit(1);
        }
        console.log(tweets);
    });

});
