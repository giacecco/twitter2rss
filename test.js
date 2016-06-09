const exec = require('child_process').exec,
      async = require('async'),
      csv = require('csv'),
      _ = require('underscore');

// This maps t's own choice of columns vs mine
const
    MAX_LIST_TIMELINE_DEPTH = 3200,
    T_FIELD_MAPPING = {
        'list': {
            'from': [ 'ID', 'Created at', 'Screen name', 'Slug', 'Members',
                'Subscribers', 'Mode', 'Description' ],
            'to': [ 'id', 'createdAt', 'screenName', 'slug', 'noOfMembers',
                'noOfSubscribers', 'mode', 'description' ],
            'ints': [ 'noOfMembers', 'noOfSubscribers' ],
            'dates': [ 'createdAt' ]
        },
        'tweet': {
            'from': [ 'ID', 'Posted at', 'Screen name', 'Text' ],
            'to': [ 'id', 'postedAt', 'screenName', 'text' ],
            'dates': [ 'postedAt' ]
        },
        'user': {
            'from': [ 'ID', 'Since', 'Last tweeted at', 'Tweets', 'Favorites',
                'Listed', 'Following', 'Followers', 'Screen name', 'Name',
                'Verified', 'Protected', 'Bio', 'Status', 'Location', 'URL' ],
            'to': [ 'id', 'userSince', 'lastTweetedAt', 'noOfTweets',
                'noOfFavorites', 'noOflisted', 'noOfFollowing', 'noOfFollowers',
                'screenName', 'name', 'verified', 'protected', 'bio', 'status',
                'location', 'url' ],
            'ints': [ 'noOfTweets', 'noOfFavorites', 'noOflisted', 'noOfFollowing',
                'noOfFollowers' ],
            'booleans': [ 'verified', 'protected' ],
            'dates': [ 'userSince', 'lastTweetedAt' ]
        }
    };

const tFieldMapGeneric = function (entry) {
    var config = this,
        newEntry = JSON.parse(JSON.stringify(entry));
    // copies the attributes, changing their names
    _.keys(config.map).forEach(function (fieldName) {
        newEntry[config.map[fieldName]] = entry[fieldName];
        delete newEntry[fieldName];
    });
    // converts the integer values to int
    (config.ints || [ ]).forEach(function (fieldName) {
        newEntry[fieldName] = parseInt(newEntry[fieldName]);
    });
    // converts the boolean values to bool
    (config.booleans || [ ]).forEach(function (fieldName) {
        newEntry[fieldName] = (newEntry[fieldName] === 'true');
    });
    // converts the dates to Date objects
    (config.dates || [ ]).forEach(function (fieldName) {
        newEntry[fieldName] = new Date(newEntry[fieldName]);
    });
    return(newEntry);
}

var tFieldMap = { }
_.keys(T_FIELD_MAPPING).forEach(function (transformationName) {
    tFieldMap[transformationName] = _.bind(
        tFieldMapGeneric,
        _.extend({
            'map': _.object(
                T_FIELD_MAPPING[transformationName].from,
                T_FIELD_MAPPING[transformationName].to
            )
        }, T_FIELD_MAPPING[transformationName])
    );
});

// runs _t_ with the specified parameters and adds a transformation of type
// _mapType_ to each entry
const execT = function(parameters, fieldMapFunction, callback) {
    exec('t ' + parameters, (error, stdout, stderr) => {
        if (error) {
            callback(new Error(error));
            return;
        }
        csv.parse(stdout, { 'columns': true }, function(err, data) {
            callback(null, data.map(fieldMapFunction));
        });
    });
}

const getListMembers = function (slug, callback) {
    execT('list members -l --csv ' + slug, tFieldMap.user, callback);
}

const getLists = function (callback) {
    execT('lists -l --csv', tFieldMap.list, function (err, lists) {
        async.each(lists, function (list, callback) {
            getListMembers(list.slug, function (err, listMembers) {
                list.members = listMembers;
                callback(null);
            });
        }, function (err) {
            callback(err, lists);
        });
    });
}

const getListTimeline = function (slug, callback) {
    execT('list timeline -n ' + MAX_LIST_TIMELINE_DEPTH + ' --csv ' + slug, tFieldMap.tweet, callback); 
}

getListTimeline('def-con-crowd', function (err, data) {
    console.log(JSON.stringify(data));
});
