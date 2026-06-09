import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 TextField input and focus", () => {
  it("createTextField() compiles", () => {
    compilesOk(`
      this.createTextField("myInput", 1, 100, 100, 200, 30);
    `);
  });

  it("TextField type='input' compiles", () => {
    compilesOk(`
      this.createTextField("myInput", 1, 100, 100, 200, 30);
      this.myInput.type = "input";
    `);
  });

  it("TextField onChanged handler compiles", () => {
    compilesOk(`
      this.myInput.onChanged = function(tf) {
        trace("changed: " + tf.text);
      };
    `);
  });

  it("TextField onSetFocus handler compiles", () => {
    compilesOk(`
      this.myInput.onSetFocus = function(oldFocus) {
        trace("got focus");
      };
    `);
  });

  it("TextField onKillFocus handler compiles", () => {
    compilesOk(`
      this.myInput.onKillFocus = function(newFocus) {
        trace("lost focus");
      };
    `);
  });

  it("Selection.setFocus() compiles", () => {
    compilesOk(`
      Selection.setFocus(this.myInput);
    `);
  });

  it("Selection.getFocus() compiles", () => {
    compilesOk(`
      var focused = Selection.getFocus();
    `);
  });

  it("TextField.tabIndex compiles", () => {
    compilesOk(`
      this.myInput.tabIndex = 1;
    `);
  });

  it("TextField.tabEnabled compiles", () => {
    compilesOk(`
      this.myInput.tabEnabled = true;
    `);
  });

  it("TextField._name property compiles", () => {
    compilesOk(`
      var name = this.myInput._name;
    `);
  });

  it("TextField.focusRect compiles", () => {
    compilesOk(`
      this.myInput.focusRect = false;
    `);
  });

  it("Full input pattern compiles", () => {
    compilesOk(`
      this.createTextField("nameField", 1, 50, 200, 200, 25);
      this.nameField.type = "input";
      this.nameField.maxChars = 20;
      this.nameField.tabIndex = 1;
      this.nameField.onChanged = function() {
        trace(this.text);
      };
    `);
  });
});
