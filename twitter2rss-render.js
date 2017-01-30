var Feed = require('feed'),
    _ = require("underscore"),
    argv = require('yargs')
        .demandCommand(1)
        .argv;

const
    APPLICATION = {
        LOCAL: "im.dico.twitter2rss",
        NAME: "twitter2rss",
        VERSION: "0.2.0"
    },
    CONFIG_FOLDER = path.join(process.env.HOME, ".config", APPLICATION.LOCAL);

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
        // the id must be an URL otherwise the feed is not valid Atom, however
        // this is not a valid URL of course
        id:      "https://github.com/Digital-Contraptions-Imaginarium/twitter2rss/" + argv._[0],
        title:   "twitter2rss_" + argv._[0],
        link:    'https://github.com/Digital-Contraptions-Imaginarium/twitter2rss',
        updated: Math.max(_.pluck(tweets, "created_at"))
    });
    tweets.forEach(function (tweet) {
        feed.addItem({
            // the id must be an URL otherwise the feed is not valid Atom
            id: "https://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str,
            author: [ {
                        "name": tweet.user.name + " (@" + tweet.user.screen_name + ")",
                        "link": 'https://twitter/' + tweet.user.screen_name
                    } ],
            title: tweet.text.split("\n")[0],
            description: tweet.text,
            date: tweet.created_at,
            link: "https://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str
        });
    });
    console.log(feed.render('atom-1.0'));
    process.exit(0);
});
