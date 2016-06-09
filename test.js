const exec = require('child_process').exec,
      async = require('async'),
      csv = require('csv'),
      _ = require('underscore');

// This maps t's own choice of columns vs mine
const T_FIELD_MAPPING = {
    "list": {
        'from': [ 'ID', 'Created at', 'Screen name', 'Slug', 'Members',
            'Subscribers', 'Mode', 'Description' ],
        'to': [ 'id', 'createdAt', 'screenName', 'slug', 'noOfMembers',
            'noOfSubscribers', 'mode', 'description' ],
        'ints': [ 'noOfMembers', 'noOfSubscribers' ],
        'dates': [ 'createdAt' ]
    },
    "user": {
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

const tFieldMap = function (mapType, entry) {
    var newEntry = JSON.parse(JSON.stringify(entry));
    // copies the attributes, changing their names
    var map = _.object(T_FIELD_MAPPING[mapType].from, T_FIELD_MAPPING[mapType].to);
    _.keys(map).forEach(function (fieldName) {
        newEntry[map[fieldName]] = entry[fieldName];
        delete newEntry[fieldName];
    });
    // converts the integer values to int
    (T_FIELD_MAPPING[mapType].ints || [ ]).forEach(function (fieldName) {
        newEntry[fieldName] = parseInt(newEntry[fieldName]);
    });
    // converts the boolean values to bool
    (T_FIELD_MAPPING[mapType].booleans || [ ]).forEach(function (fieldName) {
        newEntry[fieldName] = (newEntry[fieldName] === 'true');
    });
    // converts the dates to Date objects
    (T_FIELD_MAPPING[mapType].dates || [ ]).forEach(function (fieldName) {
        newEntry[fieldName] = new Date(newEntry[fieldName]);
    });
    return(newEntry);
}

// runs _t_ with the specified parameters and adds a transformation of type
// _mapType_ to each entry
const execT = function(parameters, mapType, callback) {
    exec('t ' + parameters, (error, stdout, stderr) => {
        if (error) {
            callback(new Error(error));
            return;
        }
        csv.parse(stdout, { 'columns': true }, function(err, data) {
            data = data.map(function (entry) {
                return tFieldMap(mapType, entry);
            });
            callback(null, data);
        });
    });
}

const getListMembers = function (slug, callback) { execT('list members -l --csv ' + slug, 'user', callback); }

const getLists = function (callback) {
    execT('lists -l --csv', 'list', function (err, lists) {
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

getLists(function (err, data) {
    console.log(JSON.stringify(data));
});
