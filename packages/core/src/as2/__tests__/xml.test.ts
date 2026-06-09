import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 XML class", () => {
  it("new XML() compiles", () => {
    compilesOk(`var x = new XML();`);
  });

  it("new XML(str) compiles", () => {
    compilesOk(`var x = new XML("<root><item/></root>");`);
  });

  it("XML.load() compiles", () => {
    compilesOk(`
      var x = new XML();
      x.load("data.xml");
    `);
  });

  it("XML.onLoad handler compiles", () => {
    compilesOk(`
      var x = new XML();
      x.onLoad = function(success) {
        if (success) trace(this.firstChild.nodeName);
      };
      x.load("data.xml");
    `);
  });

  it("XML.parseXML() compiles", () => {
    compilesOk(`
      var x = new XML();
      x.parseXML("<item id='1'>Hello</item>");
    `);
  });

  it("XML node traversal compiles", () => {
    compilesOk(`
      var x = new XML("<root><a/><b/></root>");
      var root = x.firstChild;
      var child = root.firstChild;
      var next = child.nextSibling;
      var parent = child.parentNode;
    `);
  });

  it("XML node property access compiles", () => {
    compilesOk(`
      var x = new XML("<item id='5'>text</item>");
      x.parseXML("<item id='5'>text</item>");
      var node = x.firstChild;
      var name = node.nodeName;
      var val = node.nodeValue;
      var type = node.nodeType;
    `);
  });

  it("XML.childNodes array compiles", () => {
    compilesOk(`
      var x = new XML("<root><a/><b/><c/></root>");
      var kids = x.firstChild.childNodes;
      for (var i = 0; i < kids.length; i++) {
        trace(kids[i].nodeName);
      }
    `);
  });

  it("XML.attributes object compiles", () => {
    compilesOk(`
      var x = new XML("<item id='5' class='foo'/>");
      var node = x.firstChild;
      var id = node.attributes.id;
      node.attributes.newAttr = "value";
    `);
  });

  it("createElement and appendChild compile", () => {
    compilesOk(`
      var x = new XML();
      var elem = x.createElement("item");
      var text = x.createTextNode("hello");
      elem.appendChild(text);
      x.appendChild(elem);
    `);
  });

  it("XML.toString() compiles", () => {
    compilesOk(`
      var x = new XML("<root/>");
      var str = x.toString();
    `);
  });
});
