const _ = require("underscore");

// From http://stackoverflow.com/a/3809435 + change to support 1-character
// second level domains.
const URL_REGEX = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi);

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
    let denoisedResultsIds = tweets
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
    return tweets.filter(s => _.contains(denoisedResultsIds, s.id_str));
}
