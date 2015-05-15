'use strict';

/*
 * 定义部分页面行为，比如鼠标hover 首页banner
 * */

var actions = [
/*
 * hover 更多产品
 * */
function hoverBri(page, options){
    return page.run(function(resolve){
        this.evaluate(function () {
            $(".bri").trigger("mouseover");
        });

        var time = +new Date(), _this = this;
        setTimeout(function fn(){
            var lasted = +new Date() - time;
            var isBannerCreated = _this.evaluate(function () {
                return $('.bdbri').length;
            });

            if(isBannerCreated || lasted > 1000){
                resolve(isBannerCreated); 
            }else{
                setTimeout(fn, 100); 
            }
        },100);
    });
},

/*
 * hover 设置
 * */
function hoverSet(page, options){
    return page.run(function(resolve){
        this.evaluate(function(){
            $('.pf').trigger("mouseover"); 
        }); 

        setTimeout(function(){
            resolve(); 
        },100);
    });
}

];

function invoke (page, options){
    return actions.map(function(action){
        return action(page, options); 
    });
}

module.exports = {
    invoke : invoke 
};
