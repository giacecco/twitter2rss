twitter2rss
===========

_twitter2rss_ is a script, suitable to be run as a cron job, to perform complex searches on Twitter and produce JSON or other file formats, including Atom feeds (hence the name).

Usage is:

```
$ node twitter2rss-fetch.js [configuration file] [--search search_string] [--list list_name] [--drop regexp] [--noise] [--retweets] [--replies] [--post javascript_code_or_script_file]
```

Note that you can specify any number of configuration files, search strings, postprocessing JavaScript commands etc.

The configuration files are defined using JSON files in the format below:

```
{
    "lists": [
        "list name 1",
        "list name 2",
        ...
    ],
    "searches": [
        "search string 1",
        "search string 2",
        ...
    ],
    "drops": [
        "regular expression 1",
        "regular expression 2",
        ...
    ]
}
```

Searches are specified by using the same format you would use on Twitter's website, e.g. using capital letter logical operators such as in ```#datascience OR @giacecco```. When calling Twitter's ```search/tweets``` API the ```resultType``` parameter is always set to "recent" in the attempt to avoid Twitter's editorialization (read more [here](https://dev.twitter.com/rest/reference/get/search/tweets)).

The "drops" are regular expressions applied to the tweets' text and user screen name that specify which of the fetched tweets to delete straight away, e.g. to filter out unwanted hashtag.

Any number of lists searches or drops, including none, can be specified. If multiple configuration files are specified, their parameters are merged together.

By specifying the ```--retweet``` argument, all re-tweets are dropped (statuses starting by 'RT', or marked as such in the metadata).

By specifying the ```--replies``` argument, all replies are dropped (statuses starting by '@', or marked as such in the metadata).

By specifying the ```--noise``` argument, tweets whose content differ only by the URLs or hashtags are dropped, and the oldest tweet is kept.

Only tweets in English are returned, unless one or more alternative ISO 639-1 codes are specified using the _--language_ command line parameter.

## Example

In this example below, we search Twitter for the "trump" keyword, drop the tweets that include any word ending in "hole", and save the results in a SQLlite3 database for later reuse:

```
$ cat utils/insertIntoSqlite3.sql > temp-script.sql
$ node twitter2rss-fetch --retweets --replies --noise --post utils/insertIntoSqlite3.js --search "trump" --drop "\\b.+hole\\b" >> temp-script.sql
$ sqlite3 temp-database.sqlite3 ".read temp-script.sql" 2> /dev/null
```

```temp-script.sql``` will look like:

```
CREATE TABLE IF NOT EXISTS tweets (id TEXT, payload JSON, UNIQUE(id));
INSERT OR IGNORE INTO tweets (id, payload) VALUES ('824946482369413120', '{"created_at":"2017-01-27T11:45:42.000Z","id":824946482369413100,"id_str":"824946482369413120","text":"Trump''s Order May deport 11 million https://t.co/RMzWgLnYah via @ABC BS  Trump is kicking out the criminals aliens only. ABC is inciting","truncated":false,"entities":{"hashtags":[],"symbols":[],"user_mentions":[{"screen_name":"ABC","name":"ABC News","id":28785486,"id_str":"28785486","indices":[64,68]}],"urls":[{"url":"https://t.co/RMzWgLnYah","expanded_url":"http://abcn.ws/2jsVv1U","display_url":"abcn.ws/2jsVv1U","indices":[36,59]}]},"metadata":{"iso_language_code":"en","result_type":"recent"},"source":"<a href=\"http://twitter.com\" rel=\"nofollow\">Twitter Web Client</a>","in_reply_to_status_id":null,"in_reply_to_status_id_str":null,"in_reply_to_user_id":null,"in_reply_to_user_id_str":null,"in_reply_to_screen_name":null,"user":{"id":322064312,"id_str":"322064312","name":"nauthizjane","screen_name":"nauthizjane","location":"Florida","description":"God, grant me the serenity to accept the things I cannot change,\r\n The courage to change the things I can,\r\n And the wisdom to know the difference.","url":"https://t.co/PZBtK5lBzx","entities":{"url":{"urls":[{"url":"https://t.co/PZBtK5lBzx","expanded_url":"https://wordpress.com/stats/ifiwerepresidentiwould.wordpress.com","display_url":"wordpress.com/stats/ifiwerep…","indices":[0,23]}]},"description":{"urls":[]}},"protected":false,"followers_count":1009,"friends_count":2210,"listed_count":23,"created_at":"Wed Jun 22 15:44:04 +0000 2011","favourites_count":2224,"utc_offset":-18000,"time_zone":"Quito","geo_enabled":false,"verified":false,"statuses_count":30900,"lang":"en","contributors_enabled":false,"is_translator":false,"is_translation_enabled":false,"profile_background_color":"ACB800","profile_background_image_url":"http://pbs.twimg.com/profile_background_images/569994144844505088/rXWsR5km.jpeg","profile_background_image_url_https":"https://pbs.twimg.com/profile_background_images/569994144844505088/rXWsR5km.jpeg","profile_background_tile":true,"profile_image_url":"http://pbs.twimg.com/profile_images/418753763667476481/LOhf2yuk_normal.jpeg","profile_image_url_https":"https://pbs.twimg.com/profile_images/418753763667476481/LOhf2yuk_normal.jpeg","profile_banner_url":"https://pbs.twimg.com/profile_banners/322064312/1479251348","profile_link_color":"B80062","profile_sidebar_border_color":"000000","profile_sidebar_fill_color":"95E8EC","profile_text_color":"3C3940","profile_use_background_image":true,"has_extended_profile":false,"default_profile":false,"default_profile_image":false,"following":false,"follow_request_sent":false,"notifications":false,"translator_type":"none"},"geo":null,"coordinates":null,"place":null,"contributors":null,"is_quote_status":false,"retweet_count":0,"favorite_count":0,"favorited":false,"retweeted":false,"possibly_sensitive":false,"lang":"en"}');
INSERT OR IGNORE INTO tweets (id, payload) VALUES ('824946482654613504', '{"created_at":"2017-01-27T11:45:42.000Z","id":824946482654613500,"id_str":"824946482654613504","text":"Mexican President Cancels Meeting With Trump As Tensions Rise Between Countries - https://t.co/j1Rpvy6cWr","truncated":false,"entities":{"hashtags":[],"symbols":[],"user_mentions":[],"urls":[{"url":"https://t.co/j1Rpvy6cWr","expanded_url":"https://1newsnet.com/mexican-president-cancels-meeting-with-trump-as-tensions-rise-between-countries/","display_url":"1newsnet.com/mexican-presid…","indices":[82,105]}]},"metadata":{"iso_language_code":"en","result_type":"recent"},"source":"<a href=\"https://1newsnet.com\" rel=\"nofollow\">1NewsNet</a>","in_reply_to_status_id":null,"in_reply_to_status_id_str":null,"in_reply_to_user_id":null,"in_reply_to_user_id_str":null,"in_reply_to_screen_name":null,"user":{"id":2415968864,"id_str":"2415968864","name":"1 News Net","screen_name":"1_newsnet","location":"","description":"1 NEWS NET News Videos Music VIdeos","url":"http://t.co/7ZoimdEEq0","entities":{"url":{"urls":[{"url":"http://t.co/7ZoimdEEq0","expanded_url":"http://www.1newsnet.com","display_url":"1newsnet.com","indices":[0,22]}]},"description":{"urls":[]}},"protected":false,"followers_count":16183,"friends_count":135,"listed_count":43,"created_at":"Fri Mar 28 14:13:06 +0000 2014","favourites_count":466,"utc_offset":null,"time_zone":null,"geo_enabled":false,"verified":false,"statuses_count":21594,"lang":"en-gb","contributors_enabled":false,"is_translator":false,"is_translation_enabled":false,"profile_background_color":"131516","profile_background_image_url":"http://abs.twimg.com/images/themes/theme14/bg.gif","profile_background_image_url_https":"https://abs.twimg.com/images/themes/theme14/bg.gif","profile_background_tile":true,"profile_image_url":"http://pbs.twimg.com/profile_images/475296454257291264/Uj3aJ-3r_normal.jpeg","profile_image_url_https":"https://pbs.twimg.com/profile_images/475296454257291264/Uj3aJ-3r_normal.jpeg","profile_banner_url":"https://pbs.twimg.com/profile_banners/2415968864/1482861042","profile_link_color":"009999","profile_sidebar_border_color":"EEEEEE","profile_sidebar_fill_color":"EFEFEF","profile_text_color":"333333","profile_use_background_image":true,"has_extended_profile":false,"default_profile":false,"default_profile_image":false,"following":false,"follow_request_sent":false,"notifications":false,"translator_type":"none"},"geo":null,"coordinates":null,"place":null,"contributors":null,"is_quote_status":false,"retweet_count":0,"favorite_count":0,"favorited":false,"retweeted":false,"possibly_sensitive":false,"lang":"en"}');
INSERT OR IGNORE INTO tweets (id, payload) VALUES ('824946482772058112', '{"created_at":"2017-01-27T11:45:42.000Z","id":824946482772058100,"id_str":"824946482772058112","text":"Bannon and T Trump registered to vote in two states ... https://t.co/rpPNHo4iTn","truncated":false,"entities":{"hashtags":[],"symbols":[],"user_mentions":[],"urls":[{"url":"https://t.co/rpPNHo4iTn","expanded_url":"http://fb.me/8gbH11PqV","display_url":"fb.me/8gbH11PqV","indices":[56,79]}]},"metadata":{"iso_language_code":"en","result_type":"recent"},"source":"<a href=\"http://www.facebook.com/twitter\" rel=\"nofollow\">Facebook</a>","in_reply_to_status_id":null,"in_reply_to_status_id_str":null,"in_reply_to_user_id":null,"in_reply_to_user_id_str":null,"in_reply_to_screen_name":null,"user":{"id":483284281,"id_str":"483284281","name":"The Daily Ripple Mag","screen_name":"DailyRippleMag","location":"Emmaus PA","description":"The Daily Ripple  where you can go for News Music and Ideas- Start A Ripple Today  Follow us on http://t.co/WgYkOSY5N9 News aggregator","url":"http://t.co/A3pySvY0C3","entities":{"url":{"urls":[{"url":"http://t.co/A3pySvY0C3","expanded_url":"http://www.TheDailyRipple.org","display_url":"TheDailyRipple.org","indices":[0,22]}]},"description":{"urls":[{"url":"http://t.co/WgYkOSY5N9","expanded_url":"http://Facebook-www.facebook.com/thedailyripple","display_url":"Facebook-www.facebook.com/thedailyripple","indices":[96,118]}]}},"protected":false,"followers_count":107,"friends_count":361,"listed_count":11,"created_at":"Sat Feb 04 20:59:24 +0000 2012","favourites_count":87,"utc_offset":null,"time_zone":null,"geo_enabled":true,"verified":false,"statuses_count":12334,"lang":"en","contributors_enabled":false,"is_translator":false,"is_translation_enabled":false,"profile_background_color":"DBE9ED","profile_background_image_url":"http://pbs.twimg.com/profile_background_images/417351272/thedailyripplelogo100.jpg","profile_background_image_url_https":"https://pbs.twimg.com/profile_background_images/417351272/thedailyripplelogo100.jpg","profile_background_tile":true,"profile_image_url":"http://pbs.twimg.com/profile_images/548187068447199233/UJ3DW2WJ_normal.jpeg","profile_image_url_https":"https://pbs.twimg.com/profile_images/548187068447199233/UJ3DW2WJ_normal.jpeg","profile_banner_url":"https://pbs.twimg.com/profile_banners/483284281/1422728013","profile_link_color":"CC3366","profile_sidebar_border_color":"C0DEED","profile_sidebar_fill_color":"DDEEF6","profile_text_color":"333333","profile_use_background_image":true,"has_extended_profile":false,"default_profile":false,"default_profile_image":false,"following":false,"follow_request_sent":false,"notifications":false,"translator_type":"none"},"geo":null,"coordinates":null,"place":null,"contributors":null,"is_quote_status":false,"retweet_count":0,"favorite_count":0,"favorited":false,"retweeted":false,"possibly_sensitive":false,"lang":"en"}');
```

Note that the script can be called repeatedly without causing errors, as the table will be created only if it does not exist already and duplicate tweets will be automatically ignored.

Then, you'll be able to launch sqlite3 and run queries such as:

```
$ sqlite3 temp-database.sqlite3
SQLite version 3.13.0 2016-05-18 10:57:30
Enter ".help" for usage hints.
sqlite> select json_extract(payload, '$.text') from tweets limit 3;
Trump's Order May deport 11 million https://t.co/RMzWgLnYah via @ABC BS  Trump is kicking out the criminals aliens only. ABC is inciting
Mexican President Cancels Meeting With Trump As Tensions Rise Between Countries - https://t.co/j1Rpvy6cWr
Bannon and T Trump registered to vote in two states ... https://t.co/rpPNHo4iTn
sqlite>
```
