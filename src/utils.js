import { DOUBLE_TAP_RADIUS, ACCEPTABLE_CONTENT_FORMAT } from './constants';


/**
 * 节流
 * @param {Function} func 
 * @param {Number} wait 
 * @param {Object} options
 * {
 *  leading：false 表示禁用第一次执行
 *  trailing: false 表示禁用停止触发的回调
 * }
 * (leading: false 和 trailing: false 不能同时设置！)
 * 
 * 参考：https://github.com/mqyqingfeng/Blog/issues/26
 */
function throttle(func, wait, options) {
  var timeout, context, args;
  var previous = 0;
  if (!options) options = {};

  var later = function () {
    previous = options.leading === false ? 0 : new Date().getTime();
    timeout = null;
    func.apply(context, args);
    if (!timeout) context = args = null;
  };

  var throttled = function () {
    var now = new Date().getTime();
    if (!previous && options.leading === false) previous = now;
    var remaining = wait - (now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      func.apply(context, args);
      if (!timeout) context = args = null;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
  };
  return throttled;
}


function on() {
  return (node, eventName, handler, capture) =>
    node.addEventListener(eventName, handler, capture || false);
}

function off() {
  return (node, eventName, handler, capture) =>
    node.removeEventListener(eventName, handler, capture || false);
}


function listen(node, eventName, handler, capture) {
  on(node, eventName, handler, capture);
  return () => {
    off(node, eventName, handler, capture);
  }
}



/**
 * ====== transform related ======
 */
function getTranslateX(x) {
  return `translate3d(${x}px, 0px, 0px)`;
}

function setTranslateX(element, x) {
  element.style['transform'] = getTranslateX(x);
}

function getTransform(x, y, zoom) {
  var prefix = 'translate3d(';
  var postfix = ', 0px)';
  if(zoom !== undefined) {
    return `${prefix}${x}px, ${y}px${postfix} scale(${zoom})`;
  }
  return `${prefix}${x}px, ${y}px${postfix}`;
}

function setTransform(element, x, y, zoom) {
  element.style['transform'] = getTransform(x, y, zoom);
}



/**
 * ====== gesture calculate related ======
 */
// points pool, reused during touch events
function getTouchPoints(e) {
  var _ePoint1 = {},
      _ePoint2 = {},
      _tempPointsArr = [];

  var _convertTouchToPoint = (touch) => ({
    x: touch.pageX,
    y: touch.pageY,
    id: touch.identifier
  });

  // clean up previous points
  if(_tempPointsArr.length > 0) {
    _tempPointsArr.length = 0;
  }

  if(e.type.indexOf('touch') > -1) {
    if(e.touches && e.touches.length > 0) {
      _ePoint1 = _convertTouchToPoint(e.touches[0]);
      _tempPointsArr[0] = _ePoint1;
      if(e.touches.length > 1) {
        _ePoint2 = _convertTouchToPoint(e.touches[1]);
        _tempPointsArr[1] = _ePoint2;
      }
    }
  } else {
    _ePoint1 = { x: e.pageX, y: e.pageY, id: '' };
    _tempPointsArr[0] = _ePoint1;//_ePoint1;
  }

  return _tempPointsArr;
}

function isEqualPoints(p1, p2) {
	return p1.x === p2.x && p1.y === p2.y;
}

function roundPoint(p) {
	p.x = Math.round(p.x);
	p.y = Math.round(p.y);
}

function equalizePoints(p1, p2) {
  p1.x = p2.x;
  p1.y = p2.y;
  if(p2.id) {
    p1.id = p2.id;
  }
}

function findCenterOfPoints(p1, p2) {
  return {
    x: (p1.x + p2.x) * 0.5,
    y: (p1.y + p2.y) * 0.5
  }
}

function calculatePointsDistance(p1, p2) {
  var tempPoint = {};
  tempPoint.x = Math.abs( p1.x - p2.x );
  tempPoint.y = Math.abs( p1.y - p2.y );
  return Math.sqrt(tempPoint.x * tempPoint.x + tempPoint.y * tempPoint.y);
}

function isNearbyPoints(touch0, touch1) {
  return (
    Math.abs(touch0.x - touch1.x) < DOUBLE_TAP_RADIUS
    && Math.abs(touch0.y - touch1.y) < DOUBLE_TAP_RADIUS
  );
}

function getCurrentTime() {
	return new Date().getTime();
}



/**
 * ====== item content format checker ======
 */
function checkImageFormat(item) {
  return checkItemFormat(item) === 'src';
}

function checkItemFormat(item) {
  if(item) {
    const result = ACCEPTABLE_CONTENT_FORMAT.filter(i => item.hasOwnProperty(i));
    if(result.length > 0) {
      return result[0];
    }
  }
}



export {
  throttle,
  listen,

  getTranslateX,
  setTranslateX,
  getTransform,
  setTransform,

  getTouchPoints,
  isEqualPoints,
  roundPoint,
  equalizePoints,
  findCenterOfPoints,
  calculatePointsDistance,
  isNearbyPoints,
  getCurrentTime,

  checkImageFormat,
  checkItemFormat
}