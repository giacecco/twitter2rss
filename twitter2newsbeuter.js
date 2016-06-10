const fs = require('fs'),
      path = require('path'),
      Twitter = require('twitter'),
      Feed = require('feed'),
      argv = require('yargs').argv,
      _ = require('underscore');

const twitterClient = new Twitter(JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.config', 'twitter2newsbeuter', 'twitter-config.json'), { 'encoding': 'utf8' })));

const getListStatusesByName = function (name, callback) {
    twitterClient.get("lists/list.json", { }, function(err, lists, response) {
        if (err) return callback(err);
        var list = lists.find(function (l) { return l.name.toLowerCase() === name.toLowerCase(); });
        if (!list) return callback(new Error("The specified list does not exist."));
        twitterClient.get("lists/statuses.json", { "list_id": list.id }, function(err, statuses, response) {
            callback(err, { "list": list, "statuses": statuses });
        });
    });
}

getListStatusesByName(argv._[0], function (err, list) {
    // convert all dates
    list.statuses.forEach(function (s) { s.created_at = new Date(s.created_at); });
    // create the feed
    var feed = new Feed({
        id:          list.list.name,
        title:       'Twitter - ' + list.list.name,
        link:        'http://example.com/',
        updated:     Math.max(_.pluck(list.statuses, "created_at"))
    });
    list.statuses.forEach(function (tweet) {
        feed.addItem({
            id:             tweet.id_str,
            title:          tweet.text,
            date:           new Date(tweet.created_at),
            link:           "https://twitter.com/account/redirect_by_id/" + tweet.id_str,
            description:    tweet.text
        });
    });
    console.log(feed.render('atom-1.0'));
});
