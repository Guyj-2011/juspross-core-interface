/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OrbScene } from "./OrbScene";

function fixture() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 15);
  const controls = new OrbitControls(camera);
  controls.minDistance = 0.03;
  controls.maxDistance = 34;
  const scene = { controls, pauseAutoRotateAfterZoom() {} };
  const zoomIn = () => OrbScene.prototype.zoomIn.call(scene as unknown as OrbScene);
  const zoomOut = () => OrbScene.prototype.zoomOut.call(scene as unknown as OrbScene);
  return { camera, controls, zoomIn, zoomOut };
}

describe("core zoom buttons", () => {
  test("plus approaches the core", () => {
    const { camera, zoomIn } = fixture();
    zoomIn();
    expect(camera.position.length()).toBeCloseTo(12);
  });
  test("minus moves away from the core", () => {
    const { camera, zoomOut } = fixture();
    zoomOut();
    expect(camera.position.length()).toBeCloseTo(18.75);
  });
  test("maximum zoom still reaches the gear-revealing heart", () => {
    const { camera, controls, zoomIn } = fixture();
    for (let i = 0; i < 60; i++) zoomIn();
    expect(controls.minDistance).toBe(0.03);
    expect(camera.position.length()).toBeCloseTo(0.03);
    expect(camera.position.length()).toBeLessThan(0.9);
  });
  test("zoom out remains bounded", () => {
    const { camera, zoomOut } = fixture();
    for (let i = 0; i < 60; i++) zoomOut();
    expect(camera.position.length()).toBeCloseTo(34);
  });
});