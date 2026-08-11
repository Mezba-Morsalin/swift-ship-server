const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')
const dotenv = require('dotenv')
const cors = require('cors')

const app = express()
dotenv.config()

const port = process.env.PORT

app.get('/', (req, res) => {
    res.send("Swift Server Running Successfully")
})
app.listen(port, ()=>{
    console.log(`Example app listening on port ${port}`)
})