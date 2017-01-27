var Feed = require('feed'),
    _ = require("underscore"),
    argv = require('yargs')
        .demandCommand(1)
        .argv;

let data = "";

process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(chunk) { data += chunk; });

process.stdin.on('end', function() {

    // converts the pipe into a JavaScript array of tweets
    let tweets = data.split("\n").reduce((memo, line) => {
        try {
            return memo.concat(JSON.parse(line));
        } catch (e) {
            return memo;
        }
    }, [ ]);

    // makes all the *created_at* back into dates
    tweets.forEach(t => t.created_at = new Date(t.created_at));

    // create the feed
    let feed = new Feed({
        id:      argv._[0],
        title:   "twitter2rss_" + argv._[0],
        link:    'https://github.com/Digital-Contraptions-Imaginarium/twitter2rss',
        updated: Math.max(_.pluck(tweets, "created_at"))
    });
    tweets.forEach(function (tweet) {
        feed.addItem({
            id: tweet.id_str,
            author: [ {
                        "name": tweet.user.name + " (@" + tweet.user.screen_name + ")",
                        "link": 'https://twitter/' + tweet.user.screen_name
                    } ],
            title:
                "@"
                + tweet.user.screen_name
                + (tweet.text.split("<br>").length > 2 ? " (" + tweet.text.split("<br>").length + ")" : "")
                + ": " + tweet.text.split("\n")[0],
            description: tweet.text,
            date: tweet.created_at,
            link: "https://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str
        });
    });
    console.log(feed.render('atom-1.0'));
    process.exit(0);
});
