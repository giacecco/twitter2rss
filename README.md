twitter2newsbeuter
==================

_twitter2newsbeuter_ is a script, suitable to be run as a daemon, that produces
Atom feeds out of sets of Twitter searches and list timelines. The feeds are
then suitable for consumption by any news feeder, such as
[Newsbeuter](http://newsbeuter.org/).

The feeds are defined using JSON files in the format below:

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
    ]
}
```

Searches are specified by using the same format you would use on Twitter's
website, e.g. using capital letter logical operators such as in ```#datascience
OR @giacecco```.

Any number of lists or searches, including none, can be specified. The script
will read all configuration files located in
_$HOME/.config/twitter2newsbeuter/feeds_.

The generated output feeds are then rendered into
_$HOME/.local/twitter2newsbeuter/feeds_, using the same name as the
corresponding JSON files, and with an XML extension.

The file _$HOME/.config/twitter2newsbeuter/config_ is used to specify general
working parameters, including the credentials to access Twitter. Its format is
described below. The instructions to create these settings is outside of the
scope of this document.

```
{
    "twitter":
        {
            "consumer_key": "your_consumer_key",
            "consumer_secret": "your_consumer_secret",
            "access_token_key": "your_access_token_key",
            "access_token_secret": "your_access_token_secret"
        }
}
```

The feeds are refreshed by default every 15 minutes, unless otherwise specified
using the _--refresh_ command line parameter. The script attempts to fetch a
max of 1000 new tweets per list, and 100 new tweets per search.

Tweets whose ids or content is duplicated are dropped, and the oldest tweet is
kept. Re-tweets are excluded by default, unless the _--retweet_ command line
parameter is specified.

Only tweets in English are returned, unless alternative ISO 639-1 codes are
specified using the _--language_ command line parameter, once for each code.

The script is configured to be consistent with Twitter's API rate limiting, It
is possible, however, to reduce the rate by specifying a target percentage
with the _--limiter_ command line parameter. _--limiter 70_ for example reduces
the rate to the 70% of the maximum allowed.

##Licence
This software is copyright (c) 2016 Digital Contraptions Imaginarium Ltd. and
released under the MIT Licence (MIT).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
