'use strict';

var promise = require('bluebird'),
    phantom = require('./phantom.js'),
    _ = require('lodash');

function getOverrideSelectors(stylesheet, ignore) {
    var rules = stylesheet.rules,
        overrideSelectors = [],
        hash = {};

    _.chain(rules)
         .map(function(rule){
             if(rule.selectors){
                 return rule.selectors.map(function(selector) {
                     /*
                      * selector : ".selectorA .selectorB"
                      * name     : ".selectorB"
                      * */
                     var arr = selector.split(/\s+/), len = arr.length;
                     //return {selector : selector, rule : rule, name : arr[len - 1]}; 
                     return {selector : selector, rule : rule, name : selector}; 
                 });

             }else{
                 return [];
             }
         })
         .flatten()

         //找出所有重复定义过的selectors
         .each(function(selector){
             if(!hash[selector.name]) {
                 hash[selector.name] = [];  
             }else{
                 hash[selector.name].push(selector);
             }
         })

         //the method is lazy util value be called
         .value();

    for(var p in hash){
        var items = hash[p];
        if(items.length > 1) { 
            overrideSelectors.push(
                items.map(function(item){
                    return item.rule;
                })
            );
        }
    }
        
    return overrideSelectors;
}

function getOverrideProperty (selectors){
    var hash = {};

    //标注重载属性
    for(var i = 0, len = selectors.length; i < len; i++){
        var selectorA = selectors[i]; 

        for(var j = i + 1; j < len; j++){
            var selectorB = selectors[j]; 

            //遍历属性
            for(var k = 0; k < selectorA.declarations.length; k++){
                var dec = selectorA.declarations[k];

                //在之前的比较中，已经被标注为重载
                if(dec._override) continue;

                var index = _.findIndex(selectorB.declarations, function(declaration){
                    return declaration.property == dec.property;
                });

                if(index != -1){
                    dec._override = 1; 
                    selectorB.declarations[index]._override = 1;
                }
            }
        }
    }
    
    return selectors.map(function(selector){
        selector.declarations = selector.declarations.filter(function(declaration){
            return declaration._override === 1; 
        }); 
        return selector;

    }).filter(function(selector){
        return selector.declarations && selector.declarations.length; 
    });
}

module.exports = function override(pages, stylesheet, ignore) {
    return getOverrideSelectors (stylesheet)
                .map(function(selectors){
                    return getOverrideProperty(selectors); 
                })
                .filter(function(selectors){
                    return selectors.length; 
                })
                .map(function(rules){
                    return { stylesheet :{rules : rules} };
                });
};

