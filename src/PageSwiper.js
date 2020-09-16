import React, { Component } from 'react';
import {
  animationTimingFunction,
  s,
  numAnimations,
  stopAllAnimations,
  animateProp
} from './animation';
import {
  throttle,
  getTranslateX,
  setTranslateX,
  getTouchPoints,
  equalizePoints,
  isNearbyPoints,
  getCurrentTime,
  checkImageFormat,
  checkItemFormat
} from './utils';
import {
  DIRECTION_CHECK_OFFSET,
  MIN_SWIPE_DISTANCE
} from './constants';

import ImageResizer from './ImageResizer';
import HtmlContainer from './HtmlContainer';



function detectOrient(){
  if(Math.abs(window.orientation) === 90) {
    return 'H'; // 横屏
  } else {
    return 'V'; // 竖屏
  }
}


export default class PageSwiper extends Component {
  /**
   * viewport size that include slide spacing
   */
  _slideSize = { x: 0, y: 0 }


  /**
   * throttle resize and orientationchange event
   */
  _handleSizeChange = null


  /**
   * animation related
   */
  _dragAnimFrame = null // window.requestAnimationFrame
  _releaseAnimData = undefined // calculate gesture


  /**
   * gesture detection
   * 
   * there're five gestures included:
   * - pan (image drag)
   * - swipe (slide page)
   * - zoom (only accept two fingers)
   * - tap (has 300ms delay)
   * - doubleTap (tap twice)
   */
  _isDragging = false // at least one pointer is down
  _isFirstMove = false  // for detecting gesture
  _moved = false  // true when page moved or image panned
  _mainScrollShifted = false  // true only when page moved
  _mainScrollAnimating = false // trigger when finishing swipe main scroll gesture

  _posPoints = [] // array of points during dragging, used to determine type of gesture
  _gestureStartTime = undefined
  _gestureCheckSpeedTime = undefined
  _lastReleaseTime = 0

  _currentPoints = null // null or Array, all current touch points
  _direction = null // move direction
  _currPoint = {} // current touch point during gesture
  _startPoint = {} // initial touch point during gesture
  _delta = {} // delta between two points


  /**
   * main scroll movement
   */
  _currentItemIndex = 0 // current page index
  _indexDiff = 0
  _currPositionIndex = 0 // offset index that main scroll shifted
  _startMainScrollPos = { x: 0, y: 0 } // initial main scroll position
  _mainScrollPos = { x: 0, y: 0 } // run-time main scroll position


  /**
   * tap gesture related
   */
  _isMultitouch = false // at least two pointers are down, detect tap gesture
  _tapTimer = null
  _tapReleasePoint = { x: 0, y: 0 }


  /**
   * zoom gesture related
   */
  _isZooming = false
  _zoomStarted = false
  _zoomWrapperRef = null // ImageResizer component ref of current page



  _emitEvent = (name, ...arg) => {
    if(this.props[name]) {
      this.props[name](...arg);
    }
  }

  _isZoomable = () => {
    return this._zoomWrapperRef && this._zoomWrapperRef.state.loaded;
  }

  _dispatchZoomEvent = (name, ...arg) => {
    if(this._isZoomable()) {
      return this._zoomWrapperRef[name](...arg);
    }
  }

  _initDragReleaseAnimation = () => ({
    calculateSwipeSpeed: (axis) => {
      let lastFlickDuration;
      let tempReleasePos;
      if(this._posPoints.length > 1) {
        lastFlickDuration = getCurrentTime() - this._gestureCheckSpeedTime + 50;
        tempReleasePos = this._posPoints[this._posPoints.length-2][axis];
      } else {
        lastFlickDuration = getCurrentTime() - this._gestureStartTime; // total gesture duration
        tempReleasePos = this._startPoint[axis];
      }
      s.lastFlickOffset[axis] = this._currPoint[axis] - tempReleasePos;
      s.lastFlickDist[axis] = Math.abs(s.lastFlickOffset[axis]);
      if(s.lastFlickDist[axis] > 20) {
        s.lastFlickSpeed[axis] = s.lastFlickOffset[axis] / lastFlickDuration;
      } else {
        s.lastFlickSpeed[axis] = 0;
      }
      if( Math.abs(s.lastFlickSpeed[axis]) < 0.1 ) {
        s.lastFlickSpeed[axis] = 0;
      }

      s.slowDownRatio[axis] = 0.95;
      s.slowDownRatioReverse[axis] = 1 - s.slowDownRatio[axis];
      s.speedDecelerationRatio[axis] = 1;
    }
  })

  _getLoopedIndex = index => {
    var numSlides = this.props.items.length;
    if(index > numSlides - 1) {
      return index - numSlides;
    } else if(index < 0) {
      return numSlides + index;
      }
    return index;
    }



/**
 * ====================================
 * ============ lifecycles ============
 * ====================================
 */
  constructor(props) {
    super(props);

    //initialize currentItemIndex
    let index = this.props.initialIndex;
    if(isNaN(index) || index < 0 || index >= this.props.items.length) {
      index = 0;
    }
    this._currentItemIndex = index;

    this._releaseAnimData = this._initDragReleaseAnimation();

    /**
     * Fix: resize event bug in ios wechat browser (test env: IOS v13.3.1, wechat v7.0.14)
     * 
     * DOMElement.clientWidth does not update instantly after resize
     * make sure give it a long delay (300ms not work correctly during testing)
     */
    this._handleSizeChange = throttle(this._updateSize, 400, { leading: false, trailing: true });

    this.state = {
      viewportSize: { x: 0, y: 0 },
      sharedZoomLevel: null,
      switcher: true,
      itemHolders: [{
        id: 'PAGE_A',
        positionX: null
      }, {
        id: 'PAGE_B',
        positionX: 0
      }, {
        id: 'PAGE_C',
        positionX: null
      }]
    }
  }

  componentDidMount() {
    //initialize container size, container position and item position
    this._updateSize();

    //register event listeners
    this.containerRef.addEventListener('touchstart', this._handleDragStart);
    this.containerRef.addEventListener('customTap', this._handleTap);
    window.addEventListener('resize', this._handleSizeChange);
    window.addEventListener('orientationchange', this._handleSizeChange);
  }

  componentDidUpdate(prevProps) {
    //jump page
    if(
      this.props.setItemIndexTo !== null
      && prevProps.setItemIndexTo !== this.props.setItemIndexTo
    ) {
      this.goTo(this.props.setItemIndexTo);
      this._emitEvent('onResetJumpIndex');
    }

    //go back to last page when current page is out of boundary
    if(prevProps.items.length !== this.props.items.length) {
      if(this._currentItemIndex >= this.props.items.length) {
        this.goTo(this.props.items.length - 1);
      }
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this._handleSizeChange);
    window.removeEventListener('orientationchange', this._handleSizeChange);
    this.containerRef.removeEventListener('touchstart', this._handleDragStart);
    this.containerRef.removeEventListener('customTap', this._handleTap);
    if(this._isDragging) {
      window.removeEventListener('touchmove', this._handleDragMove);
      window.removeEventListener('touchend', this._handleDragRelease);
      window.removeEventListener('touchcancel', this._handleDragRelease);
    }
  }



/**
 * ======================================
 * =========== Content Update ===========
 * ======================================
 */
  _updateSize = (e) => {
    if(!this.containerRef) { return; }

    const w = this.containerRef.clientWidth;
    const h = this.containerRef.clientHeight;

    if(w === this.state.viewportSize.x && h === this.state.viewportSize.y) {
      return;
    }

    this._slideSize = {
      x: w + Math.round(w * this.props.slideSpacing),
      y: h
    };

    //set main scroll position
    this._moveMainScroll(this._slideSize.x * this._currPositionIndex, false);

    //set item transform
    this.setState({
      viewportSize: { x: w, y: h },
      sharedZoomLevel: null,
      switcher: true,
      itemHolders: this.state.itemHolders.map((item, index) => ({
        id: item.id,
        positionX: this._slideSize.x * (-this._currPositionIndex + (index - 1))
      }))
    });

    if(e) {
      //only emit when trigger from event
      this._emitEvent('onViewportSizeChange', w, h);
    }
  }

  _updateCurrItem = (itemsDiff, setStateCallback) => {
    if(itemsDiff === 0) { return; }
    const { itemHolders } = this.state;

    if(itemsDiff > 0) {
      // swipe right, move first to last
      const translateX = itemHolders[2].positionX + (itemsDiff - 1) * this._slideSize.x;
      this.setState({
        itemHolders: [{
          id: itemHolders[1].id,
          positionX: translateX - this._slideSize.x
        }, {
          id: itemHolders[2].id,
          positionX: translateX
        }, {
          id: itemHolders[0].id,
          positionX: translateX + this._slideSize.x
        }]
      }, setStateCallback);
    } else {
      // swipe left, move last to first
      const translateX = itemHolders[0].positionX + (itemsDiff + 1) * this._slideSize.x;
      this.setState({
        itemHolders: [{
          id: itemHolders[2].id,
          positionX: translateX - this._slideSize.x
        }, {
          id: itemHolders[0].id,
          positionX: translateX
        }, {
          id: itemHolders[1].id,
          positionX: translateX + this._slideSize.x
        }]
      }, setStateCallback);
    }
  }



/**
 * ====================================
 * =========== Drag Gesture ===========
 * ====================================
 */
  _handleDragStart = e => {
    // e.preventDefault();

    const startPointsList = getTouchPoints(e);

    this._currentPoints = null;
    stopAllAnimations();

    /* === single finger === */
    if(startPointsList.length === 1 || !this._isDragging) {
      this._isDragging = true;
      this._isFirstMove = true;
      this._mainScrollShifted = false;
      this._moved = false;
      this._direction = null;

      this._zoomStarted = false;
      this._isMultitouch = false;

      window.addEventListener('touchmove', this._handleDragMove, {passive: false});
      window.addEventListener('touchend', this._handleDragRelease);
      window.addEventListener('touchcancel', this._handleDragRelease);
      this._handleTapStart(startPointsList);

      equalizePoints(this._currPoint, startPointsList[0]);
      equalizePoints(this._startPoint, this._currPoint);

      this._startMainScrollPos.x = this._slideSize.x * this._currPositionIndex;

      this._posPoints = [{ x: this._currPoint.x, y: this._currPoint.y }];

      this._gestureCheckSpeedTime = this._gestureStartTime = getCurrentTime();

      this._dispatchZoomEvent('handlePanStart');

      //start rendering
      this._stopDragUpdateLoop();
      this._dragUpdateLoop();
    }

    /* === two fingers === */
    if(
      startPointsList.length > 1
      && !this._isZooming
      && !this._mainScrollAnimating
      && !this._mainScrollShifted
      && this._isZoomable()
    ) {
      this._zoomStarted = false; //true if zoom changed at least once
      this._isMultitouch = true;
      this._isZooming = true;
      this._dispatchZoomEvent('handleZoomStart', startPointsList);
    }
  }

  _stopDragUpdateLoop = () => {
    if(this._dragAnimFrame) {
      window.cancelAnimationFrame(this._dragAnimFrame);
      this._dragAnimFrame = null;
    }
  }

  _dragUpdateLoop = () => {
    if(this._isDragging) {
      this._dragAnimFrame = window.requestAnimationFrame(this._dragUpdateLoop);
      this._renderMovement();
    }
  }

  _handleDragMove = e => {
    e.preventDefault();
    if(this._isDragging) {
      var touchesList = getTouchPoints(e);
      if(!this._direction && !this._moved && !this._isZooming) {
        if(this._mainScrollPos.x !== this._slideSize.x * this._currPositionIndex) {
          // if main scroll position is shifted – direction is always horizontal
          this._direction = 'h';
        } else {
          const diff = (
            Math.abs(touchesList[0].x - this._currPoint.x)
            - Math.abs(touchesList[0].y - this._currPoint.y)
          );
          // check the direction of movement
          if(Math.abs(diff) >= DIRECTION_CHECK_OFFSET) {
            this._direction = diff > 0 ? 'h' : 'v';
            this._currentPoints = touchesList;
          }
        }
      } else {
        this._currentPoints = touchesList;
      }
    }
  }

  _pushPosPoint = (time, x, y) => {
    if(time - this._gestureCheckSpeedTime > 50) {
      var o = this._posPoints.length > 2 ? this._posPoints.shift() : {};
      o.x = x;
      o.y = y;
      this._posPoints.push(o);
      this._gestureCheckSpeedTime = time;
    }
  }

  _renderMovement = () => {
    if(!this._currentPoints) { return; }
    if(this._currentPoints.length === 0) { return; }

    let p = {x: 0, y: 0};
    equalizePoints(p, this._currentPoints[0]);
    this._delta.x = p.x - this._currPoint.x;
    this._delta.y = p.y - this._currPoint.y;

    this._currPoint.x = p.x;
    this._currPoint.y = p.y;

    if(
      this._isZooming 
      && this._currentPoints.length > 1 
      && this._isZoomable()
    ) {
      /* === zoom === */
      // check if one of two points changed
      if(
        !this._delta.x 
        && !this._delta.y
        && this._dispatchZoomEvent('checkIfPointChanged', this._currentPoints)
      ) { return; }

      if(!this._zoomStarted) { this._zoomStarted = true; }

      this._dispatchZoomEvent('handleZoomMovement', this._currentPoints);
    } else {
      /* === swipe or pan === */
      if(!this._direction) { return; }

      //offset fixed
      if(this._isFirstMove) {
        this._isFirstMove = false;
        // subtract drag distance that was used during the detection direction
        if(Math.abs(this._delta.x) >= DIRECTION_CHECK_OFFSET) {
          this._delta.x -= this._currentPoints[0].x - this._startPoint.x;
        }
        if(Math.abs(this._delta.y) >= DIRECTION_CHECK_OFFSET) {
          this._delta.y -= this._currentPoints[0].y - this._startPoint.y;
        }
      }

      // do nothing if pointers position hasn't changed
      if(this._delta.x === 0 && this._delta.y === 0) {
        return;
      }

      this._pushPosPoint(getCurrentTime(), p.x, p.y);
      this._moved = true;

      if(this._isZoomable()) {
        //check swipe or pan
        const mainScrollChanged = this._dispatchZoomEvent(
          'panOrMoveMainScrollX', 
          this._delta,
          this._mainScrollPos,
          this._startMainScrollPos,
          p,
          this._direction,
          this._zoomStarted,
          this._mainScrollAnimating,
          this._mainScrollShifted,
          (newMainScrollPos) => {
            this._moveMainScroll(newMainScrollPos, true);
            if(newMainScrollPos === this._startMainScrollPos.x) {
              this._mainScrollShifted = false;
            } else {
              this._mainScrollShifted = true;
            }
            return this._mainScrollShifted;
          }
        );

        if(
          !mainScrollChanged
          && !this._mainScrollAnimating
          && !this._mainScrollShifted
        ) {
          this._dispatchZoomEvent(
            'panOrMoveMainScrollY',
            this._delta
          );
        }

      } else {
        //just swipe
        const newMainScrollPos = this._mainScrollPos.x + this._delta.x;
        this._moveMainScroll(newMainScrollPos, true);
        if(newMainScrollPos === this._startMainScrollPos.x) {
          this._mainScrollShifted = false;
        } else {
          this._mainScrollShifted = true;
        }
      }
    }
  }


  _moveMainScroll = (x, dragging) => {
    if(!this.props.loop && dragging) {
      const newSlideIndexOffset = this._currentItemIndex + (this._slideSize.x * this._currPositionIndex - x) / this._slideSize.x;
      const delta = Math.round(x - this._mainScrollPos.x);

      if( 
        (newSlideIndexOffset < 0 && delta > 0) 
        || (newSlideIndexOffset >= this.props.items.length - 1 && delta < 0) 
      ) {
        x = this._mainScrollPos.x + delta * this.props.mainScrollEndFriction;
      }
    }
    this._mainScrollPos.x = x;
    setTranslateX(this.mainScrollRef, x);
  }


  _handleDragRelease = e => {
    // TODO: preventDefault

    const touchList = getTouchPoints(e);
    const numPoints = touchList.length;
    let gestureType;

    // Do nothing if there were 3 touch points or more
    if(numPoints === 2) {
      this._currentPoints = null;
      return true;
    }

    // if second pointer released
    if(numPoints === 1) {
      equalizePoints(this._startPoint, touchList[0]);
    }

    // pointer hasn't moved, trigger tap event
    if(numPoints === 0 && !this._direction && !this._mainScrollAnimating) {
      if(e.changedTouches && e.changedTouches[0]) {
        let releasePoint = {
          x: e.changedTouches[0].pageX,
          y: e.changedTouches[0].pageY,
          type: 'touch'
        };
        this._onTapRelease(e, releasePoint);
      }
    }

    // Difference in time between releasing of two last touch points (zoom gesture)
    let releaseTimeDiff = -1;

    // Gesture completed, no pointers left
    if(numPoints === 0) {
      this._isDragging = false;
      window.removeEventListener('touchmove', this._handleDragMove);
      window.removeEventListener('touchend', this._handleDragRelease);
      window.removeEventListener('touchcancel', this._handleDragRelease);

      this._stopDragUpdateLoop();

      if(this._isZooming) {
        // Two points released at the same time
        releaseTimeDiff = 0;
      } else if(this._lastReleaseTime !== -1) {
        releaseTimeDiff = getCurrentTime() - this._lastReleaseTime;
      }
    }
    this._lastReleaseTime = numPoints === 1 ? getCurrentTime() : -1;

    if(releaseTimeDiff !== -1 && releaseTimeDiff < 150) {
      gestureType = 'zoom';
    } else {
      gestureType = 'swipe';
    }

    if(this._isZooming && numPoints < 2) {
      this._isZooming = false;
      // Only second point released
      if(numPoints === 1) {
        gestureType = 'zoomPointerUp'; //zoomGestureEnded
      }
    }

    this._currentPoints = null;

    if(!this._moved && !this._zoomStarted && !this._mainScrollAnimating) {
      return; // nothing to animate
    }

    stopAllAnimations();

    this._releaseAnimData.calculateSwipeSpeed('x');

    // main scroll
    if(
      (this._mainScrollShifted || this._mainScrollAnimating)
      && numPoints === 0
    ) {
      const itemChanged = this._finishSwipeMainScrollGesture(gestureType);
      if(itemChanged) {
        return;
      }
      gestureType = 'zoomPointerUp';
    }

    // prevent zoom/pan animation when main scroll animation runs
    if(this._mainScrollAnimating) {
      return;
    }

    // Complete simple zoom gesture (reset zoom level if it's out of the bounds)
    if(gestureType !== 'swipe' && this._isZoomable()) {
      this._dispatchZoomEvent('_completeZoomGesture');
      return;
    }

    // Complete pan gesture if main scroll is not shifted, and it's possible to pan current image
    if(
      !this._mainScrollShifted
      && this._dispatchZoomEvent('checkIsPossibleToPan')
    ) {
      // calculate swipe speed for Y axis (paanning)
      this._releaseAnimData.calculateSwipeSpeed('y');
      this._dispatchZoomEvent('_completePanGesture');
    }

  }


  _finishSwipeMainScrollGesture = (gestureType) => {
    const prevItemIndex = this._currentItemIndex;
    let itemChanged;
    let itemsDiff;

    if(gestureType === 'swipe') {
      const totalShiftDist = this._currPoint.x - this._startPoint.x;
      const isFastLastFlick = s.lastFlickDist.x < 10;

      // if container is shifted for more than MIN_SWIPE_DISTANCE,
      // and last flick gesture was in right direction
      if(totalShiftDist > MIN_SWIPE_DISTANCE &&
        (isFastLastFlick || s.lastFlickOffset.x > 20) ) {
        // go to prev item
        itemsDiff = -1;
      } else if(totalShiftDist < -MIN_SWIPE_DISTANCE &&
        (isFastLastFlick || s.lastFlickOffset.x < -20) ) {
        // go to next item
        itemsDiff = 1;
      }
    }

    let nextCircle;

    if(itemsDiff) {
      this._currentItemIndex += itemsDiff;
      const totalNum = this.props.items.length;

      if(this._currentItemIndex < 0) {
        this._currentItemIndex = this.props.loop ? totalNum-1 : 0;
        nextCircle = true;
      } else if(this._currentItemIndex >= totalNum) {
        this._currentItemIndex = this.props.loop ? 0 : totalNum-1;
        nextCircle = true;
      }

      if(!nextCircle || this.props.loop) {
        this._indexDiff += itemsDiff;
        this._currPositionIndex -= itemsDiff;
        itemChanged = true;
        this._updateCurrItem(itemsDiff);
        //trigger right now only page is real changed
        this._emitEvent('onSwiped', this._currentItemIndex, itemsDiff);
      }
    }

    const animateToX = this._slideSize.x * this._currPositionIndex;
    const animateToDist = Math.abs(animateToX - this._mainScrollPos.x);
    let finishAnimDuration;

    if(
      !itemChanged && (
        (animateToX > this._mainScrollPos.x) !== (s.lastFlickSpeed.x > 0)
      )
    ) {
      // "return to current" duration, e.g. when dragging from slide 0 to -1
      finishAnimDuration = 333;
    } else {
      finishAnimDuration = Math.abs(s.lastFlickSpeed.x) > 0
                        ? animateToDist / Math.abs(s.lastFlickSpeed.x)
                        : 333;
      finishAnimDuration = Math.min(finishAnimDuration, 400);
      finishAnimDuration = Math.max(finishAnimDuration, 250);
    }

    if(!this._mainScrollAnimating) {
      itemChanged = false;
    }

    this._mainScrollAnimating = true;

    animateProp(
      'mainScroll',
      this._mainScrollPos.x,
      animateToX,
      finishAnimDuration,
      animationTimingFunction.easing.cubic.out,
      this._moveMainScroll,
      () => {
        stopAllAnimations();
        this._mainScrollAnimating = false;
        this._emitEvent('onSwipeAnimationComplete', this._currentItemIndex, this._indexDiff, itemsDiff);
        this._resetLastZoom();
      }
    );

    //always trigger immediately, regardless of if page real changed
    this._emitEvent(
      'onSwipe', 
      this._currentItemIndex, 
      this._indexDiff, 
      itemsDiff, 
      prevItemIndex
    );

    return itemChanged;
  }


  _resetLastZoom = () => {
    if(this._indexDiff === 0) { return; }

    if(Math.abs(this._indexDiff) > 2) {
      this._indexDiff = 0;
      return; 
    }

    let lastItemHolderIndex;
    if(this._indexDiff > 0) {
      lastItemHolderIndex = this._indexDiff - 1;
    } else {
      lastItemHolderIndex = Math.abs(this._indexDiff) + 1;
    }

    let lastItemIndex = this._currentItemIndex + lastItemHolderIndex - 1;
    if(this.props.loop) {
      lastItemIndex = this._getLoopedIndex(lastItemIndex);
    }

    if(checkImageFormat(this.props.items[lastItemIndex])) {
      this.setState({
        itemHolders: this.state.itemHolders.map((item, index) => 
          index === lastItemHolderIndex ? (
            Object.assign({}, item, { reset: true })
          ) : item
        )
      });
    }

    this._indexDiff = 0;
  }

  _handleShareZoomLevel = (zoomLevel, reset) => {
    if(reset) {
      this.setState({ sharedZoomLevel: null, switcher: false });
    } else {
      const { items, loop } = this.props;
      let prevIndex = this._currentItemIndex - 1;
      let nextIndex = this._currentItemIndex + 1;
      if(loop) {
        prevIndex = this._getLoopedIndex(prevIndex);
        nextIndex = this._getLoopedIndex(nextIndex);
      }
      if(
        checkImageFormat(items[prevIndex]) 
        || checkImageFormat(items[nextIndex])
      ) {
        this.setState({ sharedZoomLevel: zoomLevel, switcher: false });
      }
    }
  }



/**
 * ====================================
 * =========== Tap Gesture ============
 * ====================================
 */
  _handleTapStart = touchList => {
    if(touchList.length > 1) {
      clearTimeout(this._tapTimer);
      this._tapTimer = null;
    }
  }

  _dispatchTapEvent = (origEvent, releasePoint, pointerType) => {
    //https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent
    origEvent.target.dispatchEvent(new CustomEvent('customTap', {
      bubbles: true,
      cancelable: true,
      detail: {
        origEvent: origEvent,
        target: origEvent.target,
        releasePoint: releasePoint,
        pointerType: pointerType || 'touch',
        viewportSize: { 
          x: this.state.viewportSize.x , 
          y: this.state.viewportSize.y 
        }
      }
    }));
  }

  _onTapRelease = (e, releasePoint) => {
    if(!releasePoint) { return; }

    if(!this._moved && !this._isMultitouch && !numAnimations) {
      if(this._tapTimer) {
        clearTimeout(this._tapTimer);
        this._tapTimer = null;

        // Check if taped on the same place ( Double Tap )
        if(isNearbyPoints(releasePoint, this._tapReleasePoint)) {
          this._handleDoubleTap(releasePoint);
          return;
        }
      }

      // avoid double tap delay on buttons
      var clickedTagName = e.target.tagName.toUpperCase();
      if(clickedTagName === 'BUTTON') {
        this._dispatchTapEvent(e, releasePoint);
        return;
      }

      equalizePoints(this._tapReleasePoint, releasePoint);

      this._tapTimer = setTimeout(() => {
        this._dispatchTapEvent(e, releasePoint);
        this._tapTimer = null;
      }, 300);
    }
  }

  _handleTap = customizedEvent => {
    this._emitEvent('onTap', customizedEvent);
  }

  _handleDoubleTap = point => {
    this._dispatchZoomEvent('handleDoubleTap', point);
    this._emitEvent('onDoubleTap', point);
  }



/**
 * ====================================
 * ============= Actions ==============
 * ====================================
 */
  goTo = targetIndex => {
    if(isNaN(targetIndex)) { return; }
    let index = targetIndex;
    if(index < 0 || index >= this.props.items.length) {
      if(this.props.loop) {
        index = this._getLoopedIndex(index);
      } else {
        return;
      }
    }
    if(index === this._currentItemIndex) { return; }


    const diff = index - this._currentItemIndex;


    this._indexDiff = diff;
    this._currentItemIndex = index;
    this._currPositionIndex -= diff;
    this._moveMainScroll(this._slideSize.x * this._currPositionIndex);
    stopAllAnimations();
    this._mainScrollAnimating = false;

    this._updateCurrItem(diff, this._resetLastZoom);
    this._emitEvent('onSwiped', this._currentItemIndex, diff);
  }

  goNext = () => this.goTo(this._currentItemIndex + 1)

  goPrev = () => this.goTo(this._currentItemIndex - 1)



/**
 * ====================================
 * ============= Render ===============
 * ====================================
 */
  renderImage = (src, pageIndex, reset) => {
    const { viewportSize, sharedZoomLevel, switcher } = this.state;
    const { shareImageZoomLevel } = this.props;

    let props = { viewportSize, src };

    if(pageIndex === 1) {
      //for the current
      if(shareImageZoomLevel) {
        props.initialZoomLevel = sharedZoomLevel;
        props.onZoomLevelChange = this._handleShareZoomLevel;
      }
      props.ref = node => this._zoomWrapperRef = node;
    } else {
      //for the previous and next
      if(shareImageZoomLevel) {
        if(sharedZoomLevel !== null) {
          props.setZoomLevelTo = sharedZoomLevel;
        } else {
          props.setZoomLevelTo = 'INITIAL';
        }
      } else if(reset) {
        props.setZoomLevelTo = 'INITIAL';
      }
    }

    if(detectOrient() === 'H' && switcher) {
      props.switcher = true;
    }

    return ( <ImageResizer {...props} /> );
  }

  renderItemContent = (itemHolder, pageIndex) => {
    if(this.state.viewportSize.x === 0) { return null; }

    const { watermark, loop, items } = this.props;
    let itemIndex = this._currentItemIndex + pageIndex - 1;
    if(loop) {
      itemIndex = this._getLoopedIndex(itemIndex);
    }

    let content = null;
    const item = items[itemIndex];
    if(item) {
      if(item.error) {
        return (
          <div>error.</div>
        );
      } else if(item.loading) {
        return (
          <div style={{
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            margin: 'auto',
            width: '7em',
            height: '7em'
          }}>
            loading...
          </div>
        );
      }

      const itemType = checkItemFormat(item);
      if(!itemType) { return; }

      switch (itemType) {
        case 'src':
          content = this.renderImage(item.src, pageIndex, itemHolder.reset); break;
        case 'html':
          content = <HtmlContainer html={item.html} itemIndex={itemIndex} watermark={watermark} />; break;
        case 'dom':
          content = item.dom; break;
        default: break;
      }
    }

    return content;
  }

  render() {
    const { itemHolders } = this.state;
    const { styles } = this.props;

    return (
      <div className="swiper" style={styles.swiper}>
        <div 
          className="swiper-bg"
          style={styles.background}
          ref={node => this.backgroundRef = node}
        />
        <div
          className="swiper-container"
          style={styles.container}
          ref={node => this.containerRef = node}
        >
          <div
            className="main-scroll"
            style={styles.mainScroll}
            ref={node => this.mainScrollRef = node}
          >{
            itemHolders.map((itemHolder, index) => {
              const content = this.renderItemContent(itemHolder, index);

              let itemStyle;
              if(itemHolder.positionX === null) {
                //don't display previous and next page if transform not ready
                itemStyle = { display: 'none' };
              } else {
                itemStyle = { transform: getTranslateX(itemHolder.positionX) };
              }

              return (
                <div
                  key={itemHolder.id}
                  className="main-scroll-item"
                  style={itemStyle}
                >
                  { content }
                </div>
              );
            })
          }</div>
        </div>
      </div>
    );
  }
}


PageSwiper.defaultProps = {
  styles: {
    swiper: {},
    background: {},
    container: {},
    mainScroll: {}
  },

  loop: false, // swipe infinitely
  slideSpacing: 0.12, // with percent format
  mainScrollEndFriction: 0.35,
  closeOnVerticalDrag: false,

  shareImageZoomLevel: false,

  items: [], // source data

  initialIndex: 0,

  // setItemIndexTo

  /**
   * trigger when main scroll gesture start and touch point release
   */
  // regardless of page is real changed
  // onSwipe: undefined,

  // only page is real changed
  // onSwiped: undefined, 

  // after main scroll animation complete
  // onAnimationComplete: undefined, 

  // onTap: undefined,
  // onDoubleTap: undefined
}