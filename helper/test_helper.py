#!/usr/bin/env python3
"""Unit tests for the Client.txt parser (no network). Run: python3 helper/test_helper.py"""
import unittest

from splitstone_helper import Parser

GEN = '2026/10/15 05:40:01 1234 abc [DEBUG Client 1234] Generating level {lvl} area "{area}" with seed 1'
ENT = "2026/10/15 05:40:03 1234 abc [INFO Client 1234] : You have entered {name}."


class ParserTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.p = Parser(self.events.append)

    def test_pair(self):
        self.p.feed(GEN.format(lvl=2, area="G1_2"), now=0)
        self.p.feed(ENT.format(name="Clearfell"), now=1)
        self.assertEqual(self.events, [{"type": "zone", "area": "g1_2", "name": "Clearfell", "level": 2}])

    def test_entered_only(self):
        self.p.feed(ENT.format(name="The Riverbank"), now=0)
        self.assertEqual(self.events[0]["name"], "The Riverbank")
        self.assertIsNone(self.events[0]["area"])

    def test_generating_only_flushes(self):
        self.p.feed(GEN.format(lvl=5, area="G1_5"), now=0)
        self.p.flush(now=1)
        self.assertEqual(self.events, [])
        self.p.flush(now=10)
        self.assertEqual(self.events[0]["area"], "g1_5")

    def test_noise_ignored(self):
        self.p.feed("2026/10/15 05:40:03 1 a [INFO Client 1] @From Foo: hi", now=0)
        self.p.feed("2026/10/15 05:40:03 1 a [INFO Client 1] : AFK mode is now ON.", now=0)
        self.assertEqual(self.events, [])


if __name__ == "__main__":
    unittest.main()
