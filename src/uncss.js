'use strict';

var promise = require('bluebird'),
    css = require('css'),
    fs = require('fs'),
    glob = require('glob'),
    isHTML = require('is-html'),
    isURL = require('is-absolute-url'),
    phantom = require('./phantom.js'),
    uncss = require('./lib.js').uncss,
    overrideCSS = require('./lib.js').override,
    utility = require('./utility.js'),
    _ = require('lodash');

/**
 * Get the contents of HTML pages through PhantomJS.
 * @param  {Array}   files   List of HTML files
 * @param  {Object}  options UnCSS options
 * @return {promise}
 */
function getHTML(files, options) {

    if (_.isString(files)) {
        return phantom.fromRaw(files, options.timeout).then(function (pages) {
            return [files, options, [pages]];
        });
    }

    files = _.flatten(files.map(function (file) {
        if (!isURL(file) && !isHTML(file)) {
            return glob.sync(file);
        }
        return file;
    }));

    if (!files.length) {
        throw new Error('UnCSS: no HTML files found');
    }

    return promise.map(files, function (filename) {
        if (isURL(filename)) {
            return phantom.fromRemote(filename, options);
        }
        if (fs.existsSync(filename)) {
            return phantom.fromLocal(filename, options);
        }
        // raw html
        return phantom.fromRaw(filename, options);
    }).then(function (pages) {
        return [files, options, pages];
    });
}

/**
 * Get the contents of CSS files.
 * @param  {Array}   files   List of HTML files
 * @param  {Object}  options UnCSS options
 * @param  {Array}   pages   Pages opened by phridge
 * @return {promise}
 */
function getStylesheets(files, options, pages) {
    if (options.stylesheets && options.stylesheets.length) {
        /* Simulate the behavior below */
        return [files, options, pages, [options.stylesheets]];
    }
    /* Extract the stylesheets from the HTML */
    return promise.map(pages, function (page) {
        return phantom.getStylesheets(page, options);
    }).then(function (stylesheets) {
        return [files, options, pages, stylesheets];
    });
}

function getCSS(files, options, pages, stylesheets){
    var ret = getAllCSS(files, options, pages, stylesheets);
    return [ret[0], ret[1], ret[2], _.uniq(ret[3])];  
}

/**
 * Get the contents of CSS files.
 * @param  {Array}   files       List of HTML files
 * @param  {Object}  options     UnCSS options
 * @param  {Array}   pages       Pages opened by phridge
 * @param  {Array}   stylesheets List of CSS files , file stylesheets[0] is urls, and stylesheets[1] is inline styles
 * @return {promise}
 */
function getAllCSS(files, options, pages, stylesheets) {
    /* inline styles */
    var styles = _.chain(stylesheets)
                  .map(function(fileStylesheet){
                      return fileStylesheet[1]; 
                  })
                  .flatten()
                  .value();

    stylesheets = stylesheets.map(function(fileStylesheet){
        return fileStylesheet[0]; 
    });

    /* Ignore specified stylesheets */
    /*if (options.ignoreSheets.length) {
        stylesheets = stylesheets.map(function (arr) {
            return arr.filter(function (sheet) {
                return _.every(options.ignoreSheets, function (ignore) {
                    if (_.isRegExp(ignore)) {
                        return !ignore.test(sheet);
                    }
                    return sheet !== ignore;
                });
            });
        });
    }*/

    /*外链css*/
    if (_.flatten(stylesheets).length) {
        /* Only run this if we found links to stylesheets (there may be none...)
         *  files       = ['some_file.html', 'some_other_file.html']
         *  stylesheets = [['relative_css_path.css', ...],
         *                 ['maybe_a_duplicate.css', ...]]
         * We need to - make the stylesheets' paths relative to the HTML files,
         *            - flatten the array,
         *            - remove duplicates
         */
        stylesheets =
            _.chain(stylesheets)
            .map(function (sheets, i) {
                return utility.parsePaths(files[i], sheets, options);
            })
            .flatten()
            //.uniq()
            .value();

        stylesheets = utility.readStylesheets(stylesheets);

    } else {
        /* Reset the array if we didn't find any link tags */
        stylesheets = [];
    }
    return [files, options, pages, stylesheets.concat(styles) ];
}

/**
 * Do the actual work
 * @param  {Array}   files       List of HTML files
 * @param  {Object}  options     UnCSS options
 * @param  {Array}   pages       Pages opened by phridge
 * @param  {Array}   stylesheets List of CSS files
 * @return {promise}
 */
function process(files, options, pages, stylesheets) {
    /* If we specified a raw string of CSS, add it to the stylesheets array */
    if (options.raw) {
        if (_.isString(options.raw)) {
            stylesheets.push(options.raw);
        } else {
            throw new Error('UnCSS: options.raw - expected a string');
        }
    }

    /* At this point, there isn't any point in running the rest of the task if:
     * - We didn't specify any stylesheet links in the options object
     * - We couldn't find any stylesheet links in the HTML itself
     * - We weren't passed a string of raw CSS in addition to, or to replace
     *     either of the above
     */
    if (!_.flatten(stylesheets).length) {
        throw new Error('UnCSS: no stylesheets found');
    }

    /* OK, so we have some CSS to work with!
     * Three steps:
     * - Parse the CSS
     * - Remove the unused rules
     * - Return the optimized CSS as a string
     */
    var cssStr = stylesheets.join(' \n'),
        parsed, report;

    try {
        parsed = css.parse(cssStr, { silent : true });
    } catch (err) {
        /* Try and construct a helpful error message */
        throw utility.parseErrorMessage(err, cssStr);
    }

    return uncss(pages, parsed.stylesheet, options.ignore).spread(function (used, rep) {
        var usedCss = css.stringify(used);
        var unusedSelector= used.unused.rules.map(function(rule){
            return rule.selectors.join(' , '); 
        }).join('\n');

        //console.log(unusedSelector);

        if (options.report) {
            report = {
                original: cssStr,
                selectors: rep
            };
        }
        return new promise(function (resolve) {
            resolve([usedCss + '\n', report]);
        });
    });
}

function processOverride(files, options, pages, stylesheets) {
    if (!_.flatten(stylesheets).length) {
        throw new Error('UnCSS: no stylesheets found');
    }

    var cssStr = stylesheets.join(' \n'),
        parsed, report;

    try {
        parsed = css.parse(cssStr, { silent : true });
    } catch (err) {
        /* Try and construct a helpful error message */
        throw utility.parseErrorMessage(err, cssStr);
    }

    return overrideCSS(pages, parsed.stylesheet, options.ignore).then(function (override) {
        debugger;
        override.forEach(function(rules){
            console.log(css.stringify(rules));
            console.log("\n========================\n");
        });
        return override; 
    });
}

/**
 * Main exposed function.
 * Here we check the options and callback, then run the files through PhantomJS.
 * @param  {Array}    files     Array of filenames
 * @param  {Object}   [options] options
 * @param  {Function} callback(Error, String, Object)
 * @return {promise}
 */
function init(files, options, callback) {

    if (_.isFunction(options)) {
        /* There were no options, this argument is actually the callback */
        callback = options;
        options = {};
    } else if (!_.isFunction(callback)) {
        throw new TypeError('UnCSS: expected a callback');
    }

    /* Try and read options from the specified uncssrc file */
    if (options.uncssrc) {
        try {
            /* Manually-specified options take precedence over uncssrc options */
            options = _.merge(utility.parseUncssrc(options.uncssrc), options);
        } catch (err) {
            if (err instanceof SyntaxError) {
                return callback(new SyntaxError('UnCSS: uncssrc file is invalid JSON.'));
            }
            return callback(err);

        }
    }

    /* Assign default values to options, unless specified */
    options = _.defaults(options, {
        csspath: '',
        ignore: [],
        media: [],
        timeout: 0,
        report: false,
        ignoreSheets: []
    });

    return promise
        .using(phantom.init(options.phantom), function () {
            return getHTML(files, options)
                .spread(getStylesheets)
                .spread(getCSS)
                .spread(process);
        })
        .nodeify(callback, { spread: true });
}

/*
 * an extra function, remove arguments validate
 * 流程类似init
 * 功能：查找同名selector下被多次重复定义的属性
 * */
function findOverride(files, options, callback){
    /* Assign default values to options, unless specified */
    options = _.defaults(options, {
        csspath: '',
        ignore: [],
        media: [],
        timeout: 0,
        report: false,
        ignoreSheets: []
    });   

    return promise
        .using(phantom.init(options.phantom), function () {
            return getHTML(files, options)
                .spread(getStylesheets)
                .spread(getAllCSS)
                .spread(processOverride);
        })
        .nodeify(callback, { spread: true });
}

module.exports = {
    uncss : init, 
    override : findOverride
};
