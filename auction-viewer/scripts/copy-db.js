const fs = require("fs");
const path = require("path");

const src = path.resolve(__dirname, "../../auction-database/database/auction_list.db");
const destDir = path.resolve(__dirname, "../database");
const dest = path.resolve(destDir, "auction_list.db");

// 디렉토리 없으면 생성
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// 복사
fs.copyFileSync(src, dest);
console.log("DB copied to viewer directory.");
