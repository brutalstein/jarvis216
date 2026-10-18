import unittest

from jarvis_voice.addressee import FollowUpWindow, is_named


class IsNamedTest(unittest.TestCase):
    def test_name_forms_count_as_addressed(self) -> None:
        for text in [
            "Jarvis, ışıkları kapat",
            "jarvis'e sor bakalım",
            "Carvis ne haber",
            "Cervis?",
            "JARVIS",
            "jarvisciğim",
            "çarvis",
            "jarvıs",
        ]:
            with self.subTest(text=text):
                self.assertTrue(is_named(text))

    def test_similar_words_do_not(self) -> None:
        for text in ["servis geldi mi", "Travis Scott", "bugün hava güzel"]:
            with self.subTest(text=text):
                self.assertFalse(is_named(text))


class FollowUpWindowTest(unittest.TestCase):
    def test_window_closes_after_eight_seconds(self) -> None:
        now = [100.0]
        window = FollowUpWindow(clock=lambda: now[0])
        self.assertFalse(window.is_open())
        window.open()
        now[0] = 107.9
        self.assertTrue(window.is_open())
        now[0] = 108.1
        self.assertFalse(window.is_open())


if __name__ == "__main__":
    unittest.main()
