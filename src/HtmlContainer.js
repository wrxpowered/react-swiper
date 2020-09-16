import React, { Component } from 'react';


export default class HtmlContainer extends Component {
  componentDidMount() {
    this.htmlContainerRef.oncontextmenu = () => false;
    this.htmlContainerRef.onselectstart = () => false;
  }

  render() {
    return (
      <div
        className="html-container"
        style={{
          padding: `20px 20px`
        }}
        ref={node => this.htmlContainerRef = node}
        dangerouslySetInnerHTML={{ __html: this.props.html }}
      />
    );
  }
}