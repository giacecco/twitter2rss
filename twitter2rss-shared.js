const
    fs = require("fs-extra"),
    _ = require("underscore");

// From http://stackoverflow.com/a/3809435 + change to support 1-character
// second level domains.
const URL_REGEX = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi);

exports.readConfiguration = argv => {
    let configuration = undefined;
    try {
        configuration = JSON.parse(fs.readFileSync(argv._[0], { "encoding": "utf8" }));
    } catch (err) {
        console.error("Failed reading configuration " + argv._[0] + " with error: " + err.message);
        process.exit(1);
    }
    // adds anything specified directly on the command line
    configuration.searches = _.uniq(argv.search ? configuration.searches.concat(argv.search) : configuration.searches);
    configuration.lists = _.uniq(argv.list ? configuration.lists.concat(argv.list) : configuration.lists);
    configuration.drops = _.uniq(argv.drop ? configuration.drops.concat(argv.drop) : configuration.drops);
    configuration.noise = argv.noise;
    configuration.languages = argv.language ? [ ].concat(argv.language) : [ "en" ];
    return configuration;
}

// drops tweets whose text, author name or author screen name (@something)
// matches any of the specified drops
exports.filterForDrops = (tweets, drops) => {
    if (!_.isArray(drops) || drops.length === 0) return tweets;
    let dropRegexps = drops.map(d => new RegExp(d));
    return tweets.filter(s => {
        return !_.any(dropRegexps, d => s.text.match(d)) &&
            !_.any(dropRegexps, d => s.user.name.match(d)) &&
            !_.any(dropRegexps, d => s.user.screen_name.match(d));
    });
};

// drops messages that differ just by the hashtags or URLs they
// reference and keep the oldest tweet only, if not empty
exports.filterForNoise = tweets => {
    let _tweets = JSON.parse(JSON.stringify(tweets));
    // restore the dates
    _tweets.forEach(s => s.created_at = new Date(s.created_at));
    // sort in chronological order
    _tweets = _tweets.sort((x, y) => x.created_at - y.created_at);
    let denoisedResultsIds = _tweets
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
    return _tweets.filter(s => _.contains(denoisedResultsIds, s.id_str));
}

exports.allFilters = (tweets, options) => {

    let _tweets = JSON.parse(JSON.stringify(tweets));

    // delete duplicates coming from the same tweet being captured by
    // different searches and lists, identified by tweet id
    _tweets = _.uniq(_tweets, r => r.id_str);

    // drops tweets whose text, author name or author screen name (@something)
    // matches any of the specified drops
    _tweets = exports.filterForDrops(_tweets, options.drops);

    // drop retweets, checks both the metadata and the text
    if (options.retweets) _tweets = _tweets.filter(s => !s.in_reply_to_status_id_str && !s.text.match(/^rt /i));

    // drop replies, checks both the metadata and the text
    if (options.replies) _tweets = _tweets.filter(s => !s.in_reply_to_user_id_str && !s.text.match(/^@/));

    // drops messages that differ just by the hashtags or URLs they
    // reference and keep the oldest tweet only, if not empty
    if (options.noise) _tweets = exports.filterForNoise(_tweets);

    // filter for the required languages
    _tweets = _tweets.filter(s => _.contains(options.languages, s.lang));

    return _tweets;

}
