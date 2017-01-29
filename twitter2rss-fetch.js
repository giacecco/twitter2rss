const async = require("async"),
      fs = require("fs-extra"),
      path = require("path"),
      // https://github.com/Digital-Contraptions-Imaginarium/t2
      // MIT license
      T2 = require("im.dico.t2").Twitter,
      _ = require("underscore"),
      argv = require('yargs')
          .usage("Usage: $0 \
              [configuration_file] \
              [--retweets] \
              [--replies] \
              [--noise] \
              [--language iso_639_1_code...] \
              [--post] \
          ")
          .default("language", [ "en" ])
          .argv;

// force argv.languages into an array
argv.language = [ ].concat(argv.language);

// From http://stackoverflow.com/a/3809435 + change to support 1-character
// second level domains.
const URL_REGEX = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi);

const fileExistsSync = f => {
    // TODO if the original from the *fs* library was deprecated there must be a reason...
    var ok = true; try { fs.statSync(f); } catch (err) { ok = false; }; return ok;
}

const
  APPLICATION = {
      LOCAL: "im.dico.twitter2rss",
      NAME: "twitter2rss",
      VERSION: "0.2.1"
  },
  CONFIG_FOLDER = path.join(process.env.HOME, ".local", APPLICATION.LOCAL);

var twitter = new T2({
    "local": path.join(process.env.HOME, ".local", APPLICATION.LOCAL, "t2"),
    "consumerkey": argv.consumerkey ? argv.consumerkey : process.env.TWITTER2RSS_CONSUMER_KEY,
    "consumersecret": argv.consumersecret ? argv.consumersecret : process.env.TWITTER2RSS_CONSUMER_SECRET,
    "tokenkey": argv.tokenkey ? argv.tokenkey : process.env.TWITTER2RSS_ACCESS_TOKEN_KEY,
    "tokensecret": argv.tokensecret ? argv.tokensecret : process.env.TWITTER2RSS_ACCESS_TOKEN_SECRET
});

let configuration = { "searches": [ ], "lists": [ ], "drops": [ ] };
// interprets all specified configuration files
argv._.forEach(configurationFile => {
    let newConfiguration = undefined;
    try {
        newConfiguration = JSON.parse(fs.readFileSync(configurationFile, { "encoding": "utf8" }));
    } catch (err) {
        console.error("Failed reading configuration " + configurationFile + " with error: " + err.message);
        process.exit(1);
    }
    if (newConfiguration.searches) configuration.searches = configuration.searches.concat(newConfiguration.searches);
    if (newConfiguration.lists) configuration.lists = configuration.lists.concat(newConfiguration.lists);
    if (newConfiguration.drops) configuration.drops = configuration.drops.concat(newConfiguration.drops);
});
// adds anything specified directly on the command line
configuration.searches = _.uniq(argv.search ? configuration.searches.concat(argv.search) : configuration.searches);
configuration.lists = _.uniq(argv.list ? configuration.lists.concat(argv.list) : configuration.lists);
configuration.drops = _.uniq(argv.drop ? configuration.drops.concat(argv.drop) : configuration.drops);
// does the job
let results = [ ];
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
                    // NOTE: we are resilent to errors from T2, however this
                    //       won't help debugging any issues
                    callback(null, err ? [ ] : results.statuses);
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
                    // NOTE: we are resilent to errors from T2, however this
                    //       won't help debugging any issues
                    callback(null, err ? [ ] : results);
                });
            }, (err, r) => {
                callback(err, results.concat(_.flatten(r, true)));
            });
        });
    }
], err => {

    // delete duplicates coming from the same tweet being captured by
    // different searches and lists, identified by tweet id
    results = _.uniq(results, r => r.id_str);

    // drops tweets whose text, author name or author screen name (@something)
    // matches any of the specified drops
    if (configuration.drops.length > 0) results = results.filter(s => {
        configuration.drops = configuration.drops.map(d => new RegExp(d));
        return !_.any(configuration.drops, d => s.text.match(d)) &&
            !_.any(configuration.drops, d => s.user.name.match(d)) &&
            !_.any(configuration.drops, d => s.user.screen_name.match(d));
    });

    // drop retweets, checks both the metadata and the text
    if (argv.retweets) results = results.filter(s => !s.in_reply_to_status_id_str && !s.text.match(/^rt /i));

    // drop replies, checks both the metadata and the text
    if (argv.replies) results = results.filter(s => !s.in_reply_to_user_id_str && !s.text.match(/^@/));

    // sort in chronological order
    results.forEach(s => s.created_at = new Date(s.created_at));
    results = results.sort((x, y) => x.created_at - y.created_at);

    // drops messages that differ just by the hashtags or URLs they
    // reference and keep the oldest tweet only, if not empty
    if (argv.noise) {
        let denoisedResultsIds = results
            .map(s => {
                s.text
                    // drop the URLs
                    .replace(URL_REGEX, "")
                    // drop the hashtags
                    .replace(/#[\w-]+/g, "")
                    // drop all dirty characters and spaces
                    .replace(/[^A-Za-z0-9]/g, "");
                return s;
            })
            // drop tweets that are empty after removing all the noise
            .filter(s => s.text !== "")
            .map(s => s.id_str);
        results = results.filter(s => _.contains(denoisedResultsIds, s.id_str));
    }

    // final touches
    results = results
        // filter for the required languages
        .filter(s => _.contains(argv.language, s.lang));

    // --post directives and output
    // NOTE: this is the same code as in t2cli.json in
    //       Digital-Contraptions-Imaginarium/t2
    async.reduce(!argv.post ? [ "x => JSON.stringify(x)" ] : [ ].concat(argv.post), results, (memo, p, callback) => {
        p = eval(fileExistsSync(p) ? fs.readFileSync(p, { "encoding": "utf8" }) : p);
        if (p.length > 1) {
            // the --post function is asynchronous
            return p(memo, callback);
        } else {
            // the --post function is synchronous
            callback(null, p(memo));
        }
    }, (err, results) => {
        if (err) {
            console.error("Undefined error in executing the --post commands.");
            process.exit(1);
        }
        console.log(results);
    });

});
