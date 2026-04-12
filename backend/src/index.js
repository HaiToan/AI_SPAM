const express = require('express');
const cors = require('cors'); // 1. Import cors
const apiRoutes = require('./routes/api');

const app = express();

app.use(cors()); // 2. Cho phép Frontend truy cập (Đặt TRƯỚC các routes)
app.use(express.json());

app.use('/api', apiRoutes); // 3. Sử dụng các route từ file api.js

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});