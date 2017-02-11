CREATE TABLE IF NOT EXISTS tweets (
    id_str VARCHAR(18) UNIQUE,
    created_at DATETIME,
    user_id_str VARCHAR(18),
    user_name VARCHAR(20) CHARACTER SET utf8,
    user_screen_name VARCHAR(15) CHARACTER SET utf8,
    text VARCHAR(150) CHARACTER SET utf8
);
CREATE TABLE IF NOT EXISTS tweets_themes (
    id_str VARCHAR(18) UNIQUE,
    theme VARCHAR(150) CHARACTER SET utf8
);
