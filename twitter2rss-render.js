var Feed = require('feed'),
    fs = require("fs-extra"),
    path = require("path"),
    twitter2RssShared = require("./twitter2rss-shared"),
    _ = require("underscore"),
    argv = require('yargs')
        .demandCommand(1)
        .argv;

const
    APPLICATION = {
        LOCAL: "im.dico.twitter2rss",
        NAME: "twitter2rss",
        VERSION: "0.2.0"
    };

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

    let configuration = JSON.parse(fs.readFileSync(argv._[0], { "encoding": "utf8" }));

    // makes all the *created_at* back into dates
    tweets.forEach(t => t.created_at = new Date(t.created_at));

    // drops tweets whose text, author name or author screen name (@something)
    // matches any of the specified drops
    tweets = twitter2RssShared.filterForDrops(tweets, configuration.drops);

    // drops messages that differ just by the hashtags or URLs they
    // reference and keep the oldest tweet only, if not empty
    if (argv.noise) tweets = twitter2RssShared.filterForNoise(tweets);

    // create the feed
    let feed = new Feed({
        // the id must be an URL otherwise the feed is not valid Atom, however
        // this is not a valid URL of course
        id:      "https://github.com/Digital-Contraptions-Imaginarium/twitter2rss/" + path.basename(argv._[0], ".json"),
        title:   "twitter2rss_" + path.basename(argv._[0], ".json"),
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
