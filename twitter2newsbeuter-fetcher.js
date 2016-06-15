const async = require("async"),
      fs = require("fs-extra"),
      path = require("path");

const CONFIG_PATH = path.join(process.env.HOME, ".config", "twitter2newsbeuter"),
      DATA_PATH = path.join(process.env.HOME, ".local", "twitter2newsbeuter");

const init = function (callback) {
    async.parallel([
        function (callback) { fs.mkdirs(path.join(CONFIG_PATH, "feeds"), callback); },
        function (callback) { fs.mkdirs(path.join(DATA_PATH, "feeds"), callback); },
    ], callback);
}

const main = function (callback) {

    const readFeedConfigurations = function (callback) {
        fs.readdir(path.join(CONFIG_PATH, "feeds"), function (err, entries) {
            async.filter(entries, function (entry, callback) {
                fs.lstat(path.join(CONFIG_PATH, "feeds", entry), function (err, stats) {
                    callback(null, entry.match(/\.json$/) && stats.isFile());
                });
            }, function (err, entries) {
                console.log("entries is " + entries);
                var configurations = { };
                async.each(entries, function (entry, callback) {
                    fs.readFile(path.join(CONFIG_PATH, "feeds", entry), { 'encoding': 'utf8' }, function (err, text) {
                        configurations[path.basename(entry, ".json")] = JSON.parse(text);
                        callback(err);
                    });
                }, function (err) {
                    callback(err, configurations);
                });
            });
        });
    }

    const cycle = function (callback) {
        const datestamp = new Date();
        readFeedConfigurations(function (err, configurations) {
            console.log(JSON.stringify(configurations));
            callback(null);
        });
    }

    /*
    async.whilst(
        function () { return true; },
        cycle,
        function () { }
    );
    */
    cycle(function () { });
}

init(function (err) {
    main();
})
