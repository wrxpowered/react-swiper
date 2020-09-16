import { getCurrentTime } from './utils';



const animationTimingFunction = {
  easing: {
    sine: {
      out: function(k) {
        return Math.sin(k * (Math.PI / 2));
      },
      inOut: function(k) {
        return - (Math.cos(Math.PI * k) - 1) / 2;
      }
    },
    cubic: {
      out: function(k) {
        return --k * k * k + 1;
      }
    }
  }
}



/**
 * object data that for drag release animation
 * it's shared and reused between PageSwiper and ImageResizer
 */
var s = {
  lastFlickOffset: {},
  lastFlickDist: {},
  lastFlickSpeed: {},
  slowDownRatio:  {},
  slowDownRatioReverse:  {},
  speedDecelerationRatio:  {},
  speedDecelerationRatioAbs:  {},
  distanceOffset:  {},
  backAnimDestination: {},
  backAnimStarted: {},
}



/*=============================================*/
/*=========== Micro animation engine ==========*/
/*=============================================*/
let animations = {};
let numAnimations = 0;

function stopAnimation(name) {
  if(animations[name]) {
    if(animations[name].raf) {
      window.cancelAnimationFrame( animations[name].raf );
    }
    numAnimations--;
    delete animations[name];
  }
}


function registerStartAnimation(name) {
  if(animations[name]) {
    stopAnimation(name);
  }
  if(!animations[name]) {
    numAnimations++;
    animations[name] = {};
  }
}


function stopAllAnimations() {
  for (var prop in animations) {
    if( animations.hasOwnProperty( prop ) ) {
      stopAnimation(prop);
    }
  }
}


function animateProp(name, b, endProp, d, easingFn, onUpdate, onComplete) {
  var startAnimTime = getCurrentTime(), t;
  registerStartAnimation(name);
  var animloop = function(){
    if ( animations[name] ) {
      t = getCurrentTime() - startAnimTime; // time diff
      //b - beginning (start prop)
      //d - anim duration
      if ( t >= d ) {
        stopAnimation(name);
        onUpdate(endProp);
        if(onComplete) {
          onComplete();
        }
        return;
      }
      onUpdate( (endProp - b) * easingFn(t/d) + b );
      animations[name].raf = window.requestAnimationFrame(animloop);
    }
  };
  animloop();
}


export {
  animationTimingFunction,
  s,
  animations,
  numAnimations,
  stopAnimation,
  registerStartAnimation,
  stopAllAnimations,
  animateProp
}