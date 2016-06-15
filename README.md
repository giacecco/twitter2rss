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

Any number of lists or searches, including none, can be defined. The script
expects the configuration files to be placed in _$HOME/.config/twitter2newsbeuter/feeds_.

The generated output feeds are then rendered to
_$HOME/.local/twitter2newsbeuter/feeds_, using the same name as the
corresponding JSON files and the XML extension.

The file _$HOME/.config/twitter2newsbeuter/config_ is used to specify the
credentials to access Twitter. Its format is described below.

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
