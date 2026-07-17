// Basic smoke test for the sql extension.

sql.createTable("pets", "name,kind,age")
sql.insert("pets", "Rex,dog,3")
sql.insert("pets", "Mimi,cat,2")
sql.insert("pets", "Fido,dog,5")

let dogCount = sql.select("pets", "kind", sql.CompareOp.Equal, "dog")
basic.showNumber(dogCount)

sql.update("pets", "age", "4", "name", sql.CompareOp.Equal, "Rex")
sql.deleteRows("pets", "kind", sql.CompareOp.Equal, "cat")

let total = sql.aggregate(sql.AggFunc.Sum, "age", "pets", "", sql.CompareOp.Equal, "")
basic.showNumber(total)

sql.query("SELECT * FROM pets WHERE kind = dog")
basic.showString(sql.resultAsText())

sql.exportSnapshot("pets")
