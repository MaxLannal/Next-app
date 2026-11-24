-- Schema v6: a card on a skill's canvas can be sized by hand, by dragging its edges. Null keeps the
-- size it takes from its text; a width is the card's width, a height the least it stands.
ALTER TABLE skill_nodes ADD COLUMN w REAL;
ALTER TABLE skill_nodes ADD COLUMN h REAL;
