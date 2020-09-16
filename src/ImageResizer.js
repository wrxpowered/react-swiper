import React, { Component, Fragment } from 'react';
import {
  animationTimingFunction,
  animations,
  stopAnimation,
  registerStartAnimation,
  animateProp,
  s
} from './animation';
import { 
  getCurrentTime,
  equalizePoints, 
  setTransform,
  isEqualPoints,
  roundPoint,
  findCenterOfPoints,
  calculatePointsDistance
} from './utils';



function getZeroBounds() {
  return {
    center: { x: 0, y: 0 },
    max: { x: 0, y: 0 },
    min: { x: 0, y: 0 }
  };
}


function calculatePanBounds(viewportSizeW, viewportSizeH, realPanElementW, realPanElementH) {
  // position of element when it's centered
  const center = {
    x: Math.round((viewportSizeW - realPanElementW) / 2),
    y: Math.round((viewportSizeH - realPanElementH) / 2)
  };

  // maximum pan position
  const max = {
    x: (realPanElementW > viewportSizeW) 
        ? Math.round(viewportSizeW - realPanElementW) 
        : center.x,
    y: (realPanElementH > viewportSizeH) 
        ? Math.round(viewportSizeH - realPanElementH)
        : center.y
  };

  // minimum pan position
  const min = {
    x: (realPanElementW > viewportSizeW) ? 0 : center.x,
    y: (realPanElementH > viewportSizeH) ? 0 : center.y,
  };

  return {
    center: center,
    max: max,
    min: min
  };
}




export default class ImageResizer extends Component {
  /* === image original size === */
  naturalSize = { naturalWidth: 0, naturalHeight: 0};


  /* === ratio related === */
  fitRatio = undefined; //ratio that make image just fit container's minimum side
  initialZoomLevel = undefined; //only need initialized once
  _currZoomLevel = undefined; //run-time current zoom level
  _startZoomLevel = undefined; //_currZoomLevel in last gesture


  /* === position related === */
  /**
   * image pan position bounds, calculate based on current zoom level
   *  - center: middle position(center center) [initial position]
   *  - max: maximum pan position(right bottom)
   *  - min: minimum pan position(left top)
   */
  _currPanBounds = getZeroBounds();
  _initialPosition = { x: 0, y: 0 }; //initial _currPanBounds.center
  _panOffset = { x: 0, y: 0 }; //based on the top left corner
  _startPanOffset = { x: 0, y: 0 }; //_panOffset in last gesture
  _currPanDist = { x: 0, y: 0 };



  /* === zoom gesture related === */
  _p = { x: 0, y: 0 };
  _p2 = { x: 0, y: 0 };
  _currCenterPoint = { x: 0, y: 0 };
  _midZoomPoint = { x: 0, y: 0 };
  _currPointsDistance = 0;
  _startPointsDistance = 0;



  /* === image size switch === */
  /**
   * if image natural size beyond viewport
   *   - Not zoomed: image is fit size;
   *   - Zoomed: image is natural size;
   * else image is always fit size
   */
  _renderMaxResolution = false;


  _emitEvent = (name, ...arg) => {
    if(this.props[name]) {
      this.props[name](...arg);
    }
  }


  _initDragReleaseAnimationData = () => {
    return {
      calculateOverBoundsAnimOffset: (axis, speed) => {
        if(!s.backAnimStarted[axis]) {
          if(this._panOffset[axis] > this._currPanBounds.min[axis]) {
            s.backAnimDestination[axis] = this._currPanBounds.min[axis];
          } else if(this._panOffset[axis] < this._currPanBounds.max[axis]) {
            s.backAnimDestination[axis] = this._currPanBounds.max[axis];
          }
    
          if(s.backAnimDestination[axis] !== undefined) {
            s.slowDownRatio[axis] = 0.7;
            s.slowDownRatioReverse[axis] = 1 - s.slowDownRatio[axis];
            if(s.speedDecelerationRatioAbs[axis] < 0.05) {
    
              s.lastFlickSpeed[axis] = 0;
              s.backAnimStarted[axis] = true;
    
              animateProp(
                'bounceZoomPan'+axis,
                this._panOffset[axis],
                s.backAnimDestination[axis],
                speed || 300,
                animationTimingFunction.easing.sine.out,
                (pos) => {
                  this._panOffset[axis] = pos;
                  this._applyCurrentZoomPan();
                }
              );
    
            }
          }
        }
      },
    
      // Reduces the speed by slowDownRatio (per 10ms)
      calculateAnimOffset: (axis) => {
        if(!s.backAnimStarted[axis]) {
          s.speedDecelerationRatio[axis] = s.speedDecelerationRatio[axis] * (
            s.slowDownRatio[axis] +
            s.slowDownRatioReverse[axis] -
            s.slowDownRatioReverse[axis] * s.timeDiff / 10
          );
    
          s.speedDecelerationRatioAbs[axis] = Math.abs(s.lastFlickSpeed[axis] * s.speedDecelerationRatio[axis]);
          s.distanceOffset[axis] = s.lastFlickSpeed[axis] * s.speedDecelerationRatio[axis] * s.timeDiff;
          this._panOffset[axis] += s.distanceOffset[axis];
        }
      },
    
      panAnimLoop: () => {
        if(animations.zoomPan) {
          animations.zoomPan.raf = window.requestAnimationFrame(this._releaseAnimData.panAnimLoop);
    
          s.now = getCurrentTime();
          s.timeDiff = s.now - s.lastNow;
          s.lastNow = s.now;
    
          this._releaseAnimData.calculateAnimOffset('x');
          this._releaseAnimData.calculateAnimOffset('y');
    
          this._applyCurrentZoomPan();
    
          this._releaseAnimData.calculateOverBoundsAnimOffset('x');
          this._releaseAnimData.calculateOverBoundsAnimOffset('y');
    
          if (s.speedDecelerationRatioAbs.x < 0.05 && s.speedDecelerationRatioAbs.y < 0.05) {
            // round pan position
            this._panOffset.x = Math.round(this._panOffset.x);
            this._panOffset.y = Math.round(this._panOffset.y);
            this._applyCurrentZoomPan();
    
            stopAnimation('zoomPan');
          }
        }
      }
    }
  }


  constructor(props) {
    super(props);
    this._releaseAnimData = this._initDragReleaseAnimationData();
    this.state = {
      loaded: false,
      error: false
    }
  }

  componentDidUpdate(prevProps) {
    if(!this.state.loaded) { return; }

    const { viewportSize, src, setZoomLevelTo, switcher } = this.props;

    // viewport size changed
    if(
      viewportSize.x !== prevProps.viewportSize.x
      || viewportSize.y !== prevProps.viewportSize.y
    ) {
      this._calculateItemSize();
    }

    // image source changed
    if(src !== prevProps.src) {
      this.setState({ loaded: false });
    }


    if(
      setZoomLevelTo !== prevProps.setZoomLevelTo
      || switcher !== prevProps.switcher
    ) {
      if(setZoomLevelTo !== undefined) {
        if(setZoomLevelTo === 'INITIAL') {
          if(this._currZoomLevel !== this.initialZoomLevel) {
            if(!switcher) {
            this.zoomTo(this.initialZoomLevel);
          }
          }
        } else {
          let destZoomLevel = setZoomLevelTo;
          const minZoomLevel = this.initialZoomLevel;
          const maxZoomLevel = this.props.maxSpreadZoom;
          if(setZoomLevelTo < minZoomLevel) {
            destZoomLevel = minZoomLevel;
          } else if(setZoomLevelTo > maxZoomLevel) {
            destZoomLevel = maxZoomLevel;
          }
          this.zoomTo(destZoomLevel, {x: this.props.viewportSize.x / 2, y: 0});
        }
      }
    }
  }



/** 
 * ============================================
 * =========== handle zoom gesture ============
 * ============================================
 */
  /* === handle start events === */
  handlePanStart = () => {
    this._currPanDist.x = this._currPanDist.y = 0;
    equalizePoints(this._startPanOffset, this._panOffset);
    this._calculatePanBounds(this._currZoomLevel);
  }

  handleZoomStart = startPointsList => {
    this._startZoomLevel = this._currZoomLevel;
    this._currPanDist.x = this._currPanDist.y = 0;
    equalizePoints(this._startPanOffset, this._panOffset);
    equalizePoints(this._p, startPointsList[0]);
    equalizePoints(this._p2, startPointsList[1]);

    equalizePoints(this._currCenterPoint, findCenterOfPoints(this._p, this._p2));
    this._midZoomPoint.x = Math.abs(this._currCenterPoint.x) - this._panOffset.x;
    this._midZoomPoint.y = Math.abs(this._currCenterPoint.y) - this._panOffset.y;

    this._currPointsDistance = this._startPointsDistance = calculatePointsDistance(this._p, this._p2);
  }



  /* === handle move events === */
  checkIfPointChanged = currentPoints => {
    // check if one of two points changed
    return isEqualPoints(currentPoints[1], this._p2);
  }

  handleZoomMovement = currentPoints => {
    equalizePoints(this._p, currentPoints[0]);
    equalizePoints(this._p2, currentPoints[1]);

    // Distance between two points
    const pointsDistance = calculatePointsDistance(this._p, this._p2);

    // Apply the friction if zoom level is out of the bounds
    const minZoomLevel = this.initialZoomLevel;
    const maxZoomLevel = this.props.maxSpreadZoom;
    let zoomLevel = this._calculateZoomLevel(pointsDistance);
    let zoomFriction = 1;

    if(zoomLevel < minZoomLevel) {
      zoomFriction = (minZoomLevel - zoomLevel) / minZoomLevel;
      if(zoomFriction > 1) {
        zoomFriction = 1;
      }
      zoomLevel = minZoomLevel - zoomFriction * (minZoomLevel / 3);
    } else if(zoomLevel > maxZoomLevel) {
      // 1.5 - extra zoom level above the max. E.g. if max is x6, real max 6 + 1.5 = 7.5
      zoomFriction = (zoomLevel - maxZoomLevel) / (minZoomLevel * 6);
      if(zoomFriction > 1) {
        zoomFriction = 1;
      }
      zoomLevel = maxZoomLevel + zoomFriction * minZoomLevel;
    }

    if(zoomFriction < 0) { zoomFriction = 0; }

    // distance between touch points after friction is applied
    this._currPointsDistance = pointsDistance;

    // paning with two pointers pressed
    const centerPoint = findCenterOfPoints(this._p, this._p2);
    this._currPanDist.x += centerPoint.x - this._currCenterPoint.x;
    this._currPanDist.y += centerPoint.y - this._currCenterPoint.y;
    equalizePoints(this._currCenterPoint, centerPoint);

    this._panOffset.x = this._calculatePanOffset('x', zoomLevel);
    this._panOffset.y = this._calculatePanOffset('y', zoomLevel);

    this._currZoomLevel = zoomLevel;
    this._applyCurrentZoomPan();

    this._emitEvent('onZoomLevelChange', zoomLevel, zoomLevel === this.initialZoomLevel);
  }

  //handlePanMovement
  panOrMoveMainScrollX = (
    delta,
    mainScrollPos,
    startMainScrollPos,
    p,
    direction,
    zoomStarted,
    mainScrollAnimating, 
    mainScrollShifted,
    moveMainScrollCallback
  ) => {
    equalizePoints(this._p, p);

    const axis = 'x';
    let _mainScrollShifted = mainScrollShifted;

    const newMainScrollPosition = mainScrollPos.x + delta.x;
    const mainScrollDiff = mainScrollPos.x - startMainScrollPos.x;

    let newOffset = this._panOffset[axis] + delta[axis];
    let panFriction;
    let startOverDiff;

    let newPanPos;
    let newMainScrollPos;

    if(
      newOffset > this._currPanBounds.min[axis] 
      || newOffset < this._currPanBounds.max[axis]
    ) {
      panFriction = this.props.panEndFriction;
    } else {
      panFriction = 1;
    }

    newOffset = this._panOffset[axis] + delta[axis] * panFriction;

    // move main scroll or start panning
    if(
      this.props.allowPanToNext 
      || this._currZoomLevel === this.initialZoomLevel
    ) {
      if(direction === 'h' && !zoomStarted) {
        if(delta[axis] > 0) {
          /* >>>>>> right >>>>>> */
          if(newOffset > this._currPanBounds.min[axis]) {
            panFriction = this.props.panEndFriction;
            startOverDiff = this._currPanBounds.min[axis] - this._startPanOffset[axis];
          }
          if(startOverDiff <= 0 || mainScrollDiff < 0) {
            //swipe right
            newMainScrollPos = newMainScrollPosition;
            if(mainScrollDiff < 0 && newMainScrollPosition > startMainScrollPos.x) {
              newMainScrollPos = startMainScrollPos.x;
            }
          } else {
            //pan right
            if(this._currPanBounds.min.x !== this._currPanBounds.max.x) {
              newPanPos = newOffset;
            }
          }
        } else {
          /* <<<<<< left <<<<<< */
          if(newOffset < this._currPanBounds.max[axis]) {
            panFriction = this.props.panEndFriction;
            startOverDiff = this._startPanOffset[axis] - this._currPanBounds.max[axis];
          }
          if(startOverDiff <= 0 || mainScrollDiff > 0) {
            //swipe left
            newMainScrollPos = newMainScrollPosition;
            if(mainScrollDiff > 0 && newMainScrollPosition < startMainScrollPos.x) {
              newMainScrollPos = startMainScrollPos.x;
            }
          } else {
            //pan left
            if(this._currPanBounds.min.x !== this._currPanBounds.max.x) {
              newPanPos = newOffset;
            }
          }
        }
      }

      if(newMainScrollPos !== undefined) {
        _mainScrollShifted = moveMainScrollCallback(newMainScrollPos);
      }

      if(this._currPanBounds.min.x !== this._currPanBounds.max.x) {
        if(newPanPos !== undefined) {
          this._panOffset.x = newPanPos;
        } else if(!_mainScrollShifted) {
          this._panOffset.x += delta.x * panFriction;
        }
      }

      return newMainScrollPos !== undefined;
    }

    if(!mainScrollAnimating && !_mainScrollShifted) {
      if(this._currZoomLevel > this.fitRatio) {
        this._panOffset[axis] += delta[axis] * panFriction;
      }
    }
  }

  panOrMoveMainScrollY = (delta) => {
    const axis = 'y';

    let newOffset = this._panOffset[axis] + delta[axis];
    let panFriction;

    if(
      newOffset > this._currPanBounds.min[axis] 
      || newOffset < this._currPanBounds.max[axis]
    ) {
      panFriction = this.props.panEndFriction;
    } else {
      panFriction = 1;
    }

    newOffset = this._panOffset[axis] + delta[axis] * panFriction;

    if(this._currZoomLevel > this.fitRatio) {
      this._panOffset[axis] += delta[axis] * panFriction;
    }

    roundPoint(this._panOffset);
    this._applyCurrentZoomPan();
  }



  /* === handle animation events === */
  //reset zoom level to threshold if it's out of bounds
  _completeZoomGesture = () => {
    let destZoomLevel = this._currZoomLevel;
    const minZoomLevel = this.initialZoomLevel;
    const maxZoomLevel = this.props.maxSpreadZoom;

    if(this._currZoomLevel < minZoomLevel) {
      destZoomLevel = minZoomLevel;
    } else if ( this._currZoomLevel > maxZoomLevel ) {
      destZoomLevel = maxZoomLevel;
    }

    this.zoomTo(
      destZoomLevel, 
      0, 
      200, 
      animationTimingFunction.easing.cubic.out
    );
  }


  checkIsPossibleToPan = () => {
    return this._currZoomLevel > this.fitRatio;
  }

  _completePanGesture = () => {
    s.backAnimDestination = {};
    s.backAnimStarted = {};
    
    // Avoid acceleration animation if speed is too low
    if(Math.abs(s.lastFlickSpeed.x) <= 0.05 && Math.abs(s.lastFlickSpeed.y) <= 0.05 ) {
      s.speedDecelerationRatioAbs.x = s.speedDecelerationRatioAbs.y = 0;

      // Run pan drag release animation. E.g. if you drag image and release finger without momentum.
      this._releaseAnimData.calculateOverBoundsAnimOffset('x');
      this._releaseAnimData.calculateOverBoundsAnimOffset('y');
      return true;
    }

    // Animation loop that controls the acceleration after pan gesture ends
    registerStartAnimation('zoomPan');
    s.lastNow = getCurrentTime();
    this._releaseAnimData.panAnimLoop();
  }



  /* === handle double tap event === */
  handleDoubleTap = point => {
    const doubleTapZoomLevel = this.initialZoomLevel < 0.7 ? 1 : this.props.maxSpreadZoom;

    if(this._currZoomLevel !== this.initialZoomLevel) {
      this.zoomTo(this.initialZoomLevel, point, 333);
    } else {
      this.zoomTo(doubleTapZoomLevel, point, 333);
    }
  }



/** 
 * ============================================
 * ============== style render ================
 * ============================================
 */
  _applyCurrentZoomPan = allowRenderResolution => {
    if(allowRenderResolution) {
      if(this._currZoomLevel > this.fitRatio) {
        if(!this._renderMaxResolution) {
          this._setImageSize(true);
          this._renderMaxResolution = true;
        }
      } else {
        if(this._renderMaxResolution) {
          this._setImageSize(false);
          this._renderMaxResolution = false;
        }
      }
    }
    this._applyZoomTransform(this._panOffset.x, this._panOffset.y, this._currZoomLevel);
  }

  _applyZoomTransform = (x, y, zoomLevel) => {
    if(!this._renderMaxResolution) {
      zoomLevel = zoomLevel / this.fitRatio;
    }
    setTransform(this.zoomWrapperNode, x, y, zoomLevel);
  }

  _setImageSize = maxRes => {
    const { naturalWidth, naturalHeight } = this.naturalSize;
    var w = maxRes ? naturalWidth : Math.round(naturalWidth * this.fitRatio);
    var h = maxRes ? naturalHeight : Math.round(naturalHeight * this.fitRatio);
    this.imgNode.style.width = `${w}px`;
    this.imgNode.style.height = `${h}px`;
  }

  applyZoomPan = (zoomLevel, panX, panY, allowRenderResolution) => {
    this._panOffset.x = panX;
    this._panOffset.y = panY;
    this._currZoomLevel = zoomLevel;
    this._applyCurrentZoomPan( allowRenderResolution );
  }

  zoomTo = (destZoomLevel, centerPoint, speed, easingFn, updateFn) => {
    if(centerPoint) {
      this._startZoomLevel = this._currZoomLevel;
      this._midZoomPoint.x = Math.abs(centerPoint.x) - this._panOffset.x ;
      this._midZoomPoint.y = Math.abs(centerPoint.y) - this._panOffset.y ;
      equalizePoints(this._startPanOffset, this._panOffset);
    }

    this._calculatePanBounds(destZoomLevel);
    
    var destPanOffset = {
      x: this._modifyDestPanOffset('x', destZoomLevel),
      y: this._modifyDestPanOffset('y', destZoomLevel)
    }

    var initialZoomLevel = this._currZoomLevel;
    var initialPanOffset = { x: this._panOffset.x, y: this._panOffset.y };

    roundPoint(destPanOffset);

    var onUpdate = (now) => {
      if(now === 1) {
        this._currZoomLevel = destZoomLevel;
        this._panOffset.x = destPanOffset.x;
        this._panOffset.y = destPanOffset.y;
        this._emitEvent('onZoomLevelChange', destZoomLevel, destZoomLevel === this.initialZoomLevel);
      } else {
        this._currZoomLevel = (destZoomLevel - initialZoomLevel) * now + initialZoomLevel;
        this._panOffset.x = (destPanOffset.x - initialPanOffset.x) * now + initialPanOffset.x;
        this._panOffset.y = (destPanOffset.y - initialPanOffset.y) * now + initialPanOffset.y;
      }

      if(updateFn) {
        updateFn(now);
      }

      this._applyCurrentZoomPan( now === 1 );
    };

    if(speed) {
      animateProp(
        'customZoomTo', 
        0, 
        1, 
        speed, 
        easingFn || animationTimingFunction.easing.sine.inOut, 
        onUpdate
      );
    } else {
      onUpdate(1);
    }
  }



/** 
 * ============================================
 * ================ calculate =================
 * ============================================
 */
  _calculatePanOffset = (axis, zoomLevel) => {
    const m = this._midZoomPoint[axis];
    return (
      this._startPanOffset[axis]
      + this._currPanDist[axis]
      + m
      - (m * (zoomLevel / this._startZoomLevel))
    );
  }

  // return valid value if offset is out of the bounds
  _modifyDestPanOffset = (axis, destZoomLevel) => {
    let val;
    if(destZoomLevel === this.initialZoomLevel) {
      val = this._initialPosition[axis];
    } else {
      val = this._calculatePanOffset(axis, destZoomLevel);

      const destPanBoundsMin = this._currPanBounds.min[axis];
      const destPanBoundsMax = this._currPanBounds.max[axis];

      if(val > destPanBoundsMin) {
        val = destPanBoundsMin;
      } else if(val < destPanBoundsMax) {
        val = destPanBoundsMax;
      }
    }
    return val;
  }

  _calculatePanBounds = zoomLevel => {
    const bounds = calculatePanBounds(
      this.props.viewportSize.x,
      this.props.viewportSize.y,
      this.naturalSize.naturalWidth * zoomLevel,
      this.naturalSize.naturalHeight * zoomLevel
    );
    this._currPanBounds.center = bounds.center;
    this._currPanBounds.max = bounds.max;
    this._currPanBounds.min = bounds.min;
  }

  _calculateZoomLevel = touchesDistance => {
  	return  1 / this._startPointsDistance * touchesDistance * this._startZoomLevel;
  }

  _calculateItemSize = () => {
    const { viewportSize, setZoomLevelTo, initialZoomLevel, maxSpreadZoom, switcher } = this.props;
    const { naturalWidth, naturalHeight } = this.naturalSize;

    // calculate fit ratio
    const hRatio = viewportSize.x / naturalWidth;
    const vRatio = viewportSize.y / naturalHeight;
    this.fitRatio = Math.min(hRatio, vRatio);

    // calculate initial zoom level
    let zoomLevel = this.fitRatio;
    if(zoomLevel > 1) { zoomLevel = 1; }
    this.initialZoomLevel = zoomLevel;

    const initialBounds = calculatePanBounds(
      viewportSize.x,
      viewportSize.y,
      naturalWidth * zoomLevel,
      naturalHeight * zoomLevel
    );

    this._initialPosition = initialBounds.center;


    let tempZoomLevel = setZoomLevelTo || initialZoomLevel;
    if(switcher) {
      let destZoomLevel = (viewportSize.x - 120) / naturalWidth;
      if(destZoomLevel < zoomLevel) {
        destZoomLevel = zoomLevel;
      } else if(destZoomLevel > maxSpreadZoom) {
        destZoomLevel = maxSpreadZoom;
      }
      this._startZoomLevel = this._currZoomLevel = destZoomLevel;

      this._calculatePanBounds(destZoomLevel);

      equalizePoints(this._panOffset, {x: this._currPanBounds.center.x, y: 0});
      this._applyCurrentZoomPan(true);
    } else if(
      tempZoomLevel !== null
      && tempZoomLevel !== undefined
      && tempZoomLevel !== 'INITIAL'
    ) {
      let destZoomLevel = tempZoomLevel;
      if(destZoomLevel < zoomLevel) {
        destZoomLevel = zoomLevel;
      } else if(destZoomLevel > maxSpreadZoom) {
        destZoomLevel = maxSpreadZoom;
      }
      this._startZoomLevel = this._currZoomLevel = destZoomLevel;

      this._calculatePanBounds(destZoomLevel);

      equalizePoints(this._panOffset, {x: this._currPanBounds.center.x, y: 0});
      this._applyCurrentZoomPan(true);
    } else {
      this._startZoomLevel = this._currZoomLevel = zoomLevel;

      // calculate current bounds
      this._calculatePanBounds(zoomLevel);

      // set position
      equalizePoints(this._panOffset, this._initialPosition);
      this._applyCurrentZoomPan();
    }

    this._setImageSize(this._renderMaxResolution);
  }



/** 
 * ============================================
 * =========== handle image events ============
 * ============================================
 */
  handleImageLoad = e => {
    const { naturalWidth, naturalHeight } = e.target;
    this.naturalSize.naturalWidth = naturalWidth;
    this.naturalSize.naturalHeight = naturalHeight;

    this._calculateItemSize();

    this.setState({ loaded: true });
  }

  handleImageError = e => {
    console.error(e);
    this.setState({ loaded: false, error: true })
  }


  render() {
    const { loaded, error } = this.state;
    const { src } = this.props;

    const absoluteStyle = {
      position: 'absolute',
      top: '50%',
      left: '50%',
      maxWidth: '100%',
      transform: 'translate(-50%, -50%)'
    }

    if(!src) {
      return ( 
        <div style={absoluteStyle}>
          未找到对应的图片资源。
        </div>
      ); 
    }

    if(error) {
      return ( 
        <div style={absoluteStyle}>
          图片资源加载失败。
        </div> 
      );
    }

    return (
      <Fragment>
        {
          !loaded &&
          <div style={{
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            margin: 'auto',
            width: '7em',
            height: '7em'
          }} >
            loading...
          </div>
        }
        <div
          className="zoom-wrapper"
          style={{display: loaded ? 'block' : 'none'}}
          ref={node => this.zoomWrapperNode = node}
        >
          <img
            className="zoomable-img"
            ref={node => this.imgNode = node}
            src={src}
            alt="book reading content"
            onLoad={this.handleImageLoad}
            onError={this.handleImageError}
          />
        </div>
      </Fragment>
    );
  }
}


ImageResizer.defaultProps = {
  maxSpreadZoom: 1.33,

  allowPanToNext: true,

  panEndFriction: 0.35,

  // viewportSize: { x: 0, y: 0 },

  // setZoomLevleTo

  // onZoomLevelChange
}