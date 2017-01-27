r => r.map(x => "INSERT OR IGNORE INTO tweets (id, payload) VALUES ('" + x.id_str + "', '" + JSON.stringify(x).replace(/'/g, "''") + "');").join("\n")
