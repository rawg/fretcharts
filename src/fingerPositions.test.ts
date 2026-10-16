import { describe, it, expect } from "vitest";
import { parseFingerPositions, FingerPositionError } from "./fingerPositions";

describe("parseFingerPositions", () => {
  describe("JSON form", () => {
    it("parses a JSON object keyed by string number", () => {
      expect(parseFingerPositions('{"6":"1"}')).toEqual({ 6: 1 });
    });

    it("accepts numeric JSON values as well as numeric strings", () => {
      expect(parseFingerPositions('{"6":1,"1":5}')).toEqual({ 6: 1, 1: 5 });
    });

    it("tolerates surrounding whitespace before sniffing the JSON form", () => {
      expect(parseFingerPositions('  {"3":"2"}  ')).toEqual({ 3: 2 });
    });

    it("rejects malformed JSON", () => {
      expect(() => parseFingerPositions("{not valid json")).toThrow(FingerPositionError);
    });

    it("rejects a JSON array", () => {
      expect(() => parseFingerPositions("[1,2,3]")).toThrow(FingerPositionError);
    });

    it("rejects a string number outside 1-6", () => {
      expect(() => parseFingerPositions('{"7":"1"}')).toThrow(FingerPositionError);
      expect(() => parseFingerPositions('{"0":"1"}')).toThrow(FingerPositionError);
    });

    it("rejects a finger value outside 1-5", () => {
      expect(() => parseFingerPositions('{"6":"0"}')).toThrow(FingerPositionError);
      expect(() => parseFingerPositions('{"6":"6"}')).toThrow(FingerPositionError);
      expect(() => parseFingerPositions('{"6":"abc"}')).toThrow(FingerPositionError);
    });
  });

  describe("notation form", () => {
    it("parses 'xx0321' per the spec example: labels strings 3, 2, 1 with fingers 3, 2, 1", () => {
      expect(parseFingerPositions("xx0321")).toEqual({ 3: 3, 2: 2, 1: 1 });
    });

    it("treats both 'x' and '0' as no finger", () => {
      expect(parseFingerPositions("000000")).toEqual({});
      expect(parseFingerPositions("xxxxxx")).toEqual({});
    });

    it("supports the dash/space-separated escape hatch, same as chord notation", () => {
      expect(parseFingerPositions("x-x-0-3-2-1")).toEqual({ 3: 3, 2: 2, 1: 1 });
    });

    it("supports a single finger on one string with the rest unlabeled", () => {
      expect(parseFingerPositions("xxxx1x")).toEqual({ 2: 1 });
    });

    it("rejects a digit outside 0-5 (e.g. an actual fret number, not a finger)", () => {
      expect(() => parseFingerPositions("xxxxx9")).toThrow(FingerPositionError);
    });

    it("rejects illegal characters, propagating a clear error", () => {
      expect(() => parseFingerPositions("qqqqqq")).toThrow(FingerPositionError);
    });

    it("respects a non-default stringCount (e.g. ukulele)", () => {
      expect(parseFingerPositions("0231", 4)).toEqual({ 3: 2, 2: 3, 1: 1 });
    });
  });
});
