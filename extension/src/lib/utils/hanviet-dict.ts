/**
 * Sino-Vietnamese (Hán-Việt) Dictionary Mapping for Japanese Kanji
 */

const HANVIET_MAP: Record<string, string> = {
  // Kanji to Sino-Vietnamese sound mapping
  "日": "NHẬT", "本": "BẢN", "語": "NGÔN", "学": "HỌC", "生": "SINH",
  "校": "HIỆU", "先": "TIÊN", "私": "TƯ", "人": "NHÂN", "方": "PHƯƠNG",
  "名": "DANH", "前": "TIỀN", "中": "TRUNG", "国": "QUỐC", "英": "ANH",
  "何": "HÀ", "大": "ĐẠI", "小": "TIỂU", "高": "CAO", "安": "AN",
  "新": "TÂN", "古": "CỔ", "多": "ĐA", "少": "THIỂU", "長": "TRƯỜNG",
  "短": "ĐOẢN", "重": "TRỌNG", "軽": "KHINH", "広": "QUẢNG", "早": "TẢO",
  "遅": "TRÌ", "近": "CẬN", "遠": "VIỄN", "好": "HẢO", "楽": "LẠC",
  "食": "THỰC", "飲": "ẨM", "買": "MÃI", "見": "KIẾN", "聞": "VĂN",
  "行": "HÀNH", "来": "LAI", "帰": "QUY", "会": "HỘI", "話": "THOẠI",
  "読": "ĐỘC", "書": "THƯ", "休": "HƯU", "走": "TẨU", "起": "KHỞI",
  "寝": "TẨM", "立": "LẬP", "座": "TỌA", "入": "NHẬP", "出": "XUẤT",
  "開": "KHAI", "閉": "BẾ", "始": "THỦY", "終": "CHUNG", "思": "TƯ",
  "知": "TRI", "考": "KHẢO", "教": "GIÁO", "習": "TẬP", "勉": "MIỄN",
  "強": "CƯỜNG", "道": "ĐẠO", "車": "XA", "電": "ĐIỆN", "気": "KHÍ",
  "水": "THỦY", "火": "HỎA", "木": "MỘC", "金": "KIM", "土": "THỔ",
  "天": "THIÊN", "空": "KHÔNG", "雨": "VŨ", "風": "PHONG", "海": "HẢI",
  "山": "SƠN", "川": "XUYÊN", "花": "HOA", "草": "THẢO", "犬": "KHUYỂN",
  "猫": "MIÊU", "魚": "NGƯ", "鳥": "ĐIỂU", "手": "THỦ", "足": "TÚC",
  "目": "MỤC", "耳": "NHĨ", "口": "KHẨU", "心": "TÂM", "体": "THỂ",
  "頭": "ĐẦU", "顔": "NHAN", "声": "THANH", "時": "THỜI", "分": "PHÂN",
  "秒": "MIỄU", "年": "NIÊN", "月": "NGUYỆT", "週": "CHU",
  "今": "KIM", "昨": "TÁC", "明": "MINH", "朝": "TRIÊU", "昼": "TRÚ",
  "夜": "DẠ", "晩": "VÃN", "春": "XUÂN", "夏": "HẠ", "秋": "THU",
  "冬": "ĐÔNG", "東": "ĐÔNG", "西": "TÂY", "南": "NAM", "北": "BẮC",
  "上": "THƯỢNG", "下": "HẠ", "左": "TẢ", "右": "HỮU", "内": "NỘI",
  "外": "NGOẠI", "間": "GIAN", "表": "BIỂU", "裏": "LÝ", "後": "HẬU",
  "親": "THÂN", "父": "PHỤ", "母": "MẪU", "子": "TỬ",
  "男": "NAM", "女": "NỮ", "兄": "HUYNH", "弟": "ĐỆ", "姉": "TỶ",
  "妹": "MUỘI", "夫": "PHU", "妻": "THÊ", "家": "GIA", "族": "TỘC",
  "友": "HỮU", "達": "ĐẠT", "彼": "BỈ", "世": "THẾ", "界": "GIỚI",
  "社": "XÃ", "員": "VIÊN", "店": "ĐIẾM", "病": "BỆNH", "院": "VIỆN",
  "銀": "NGÂN", "駅": "DỊCH", "図": "ĐỒ", "館": "QUÁN", "事": "SỰ",
  "物": "VẬT", "服": "PHỤC", "靴": "NGOA", "傘": "TẢN", "切": "THIẾT",
  "符": "PHÙ", "荷": "HÀ", "紙": "CHỈ", "意": "Ý",
  "味": "VỊ", "理": "LÝ", "解": "GIẢI", "情": "TÌNH", "報": "BÁO",
  "真": "CHÂN", "相": "TƯƠNG", "視": "THỊ", "聴": "THÍNH", "言": "NGÔN",
  "葉": "DIỆP", "訳": "DỊCH", "文": "VĂN", "章": "CHƯƠNG", "句": "CÚ",
  "字": "TỰ", "漢": "HÁN", "CA": "CA", "音": "ÂM",
  "画": "HỌA", "映": "ÁNH", "育": "DỤC",
  "動": "ĐỘNG", "質": "CHẤT", "問": "VẤN", "答": "ĐÁP",
  "題": "ĐỀ", "宿": "TÚC", "試": "THÍ", "験": "NGHIỆM",
  "結": "KẾT", "果": "QUẢ", "成": "THÀNH", "績": "TÍCH", "合": "Hợp",
  "格": "CÁCH", "不": "BẤT", "可": "KHẢ", "能": "NĂNG", "必": "TẤT",
  "要": "YẾU", "自": "TỰ", "由": "DO", "平": "BÌNH", "和": "HÒA",
  "全": "TOÀN", "危": "NGUY", "険": "HIỂM", "注": "CHÚ",
  "関": "QUAN", "感": "CẢM", "謝": "TẠ",
  "恋": "LUYẾN", "愛": "ÁI", "希": "HY", "望": "VỌNG", "夢": "MỘNG",
  "恐": "KHỦNG", "怖": "BỐ", "怒": "NỘ", "笑": "TIẾU", "泣": "KHẤP",
  "驚": "KINH", "寂": "TỊCH", "悲": "BI", "困": "KHỐN", "難": "NAN",
  "苦": "KHỔ", "痛": "THỐNG", "薬": "DƯỢC",
  "熱": "NHIỆT", "冷": "LÃNH", "温": "ÔN", "度": "ĐỘ",
  "力": "LỰC", "邪": "TÀ", "治": "TRỊ", "療": "LIỆU",
  "健": "KIỆN", "康": "KHANG", "寿": "THỌ", "命": "MỆNH", "死": "TỬ",
  "活": "HOẠT", "改": "CẢI", "革": "CÁCH", "変": "BIẾN",
  "化": "HÓA", "進": "TIẾN", "歩": "BỘ", "展": "TRIỂN",
  "発": "PHÁT", "掘": "QUẬT", "創": "SÁNG", "造": "TẠO", "建": "KIẾN",
  "設": "THIẾT", "破": "PHÁ", "壊": "HOẠI", "守": "THỦ", "攻": "CÔNG",
  "勝": "THẮNG", "負": "PHỤ", "戦": "CHIẾN", "争": "TRANH", "警": "CẢNH",
  "察": "SÁT", "犯": "PHẠM", "罪": "TỘI", "捕": "BỔ", "逮": "ĐÃI",
  "授": "THỤ", "業": "NGHIỆP", "政": "CHÍNH", "経": "KINH",
  "済": "TẾ", "法": "PHÁP", "律": "LUẬT", "権": "QUYỀN", "利": "LỢI",
  "義": "NGHĨA", "務": "VỤ", "責": "TRÁCH", "任": "NHIỆM", "課": "KHÓA",
  "研": "NGHIÊN", "究": "CỨU", "術": "THUẬT", "技": "KĨ",
  "工": "CÔNG", "科": "KHOA",
  "作": "TÁC", "品": "PHẨM", "芸": "NGHỆ", "写": "TẢ",
  "曲": "KHÚC", "旅": "LỮ", "遊": "DU", "戯": "HÍ",
  "敗": "BẠI", "得": "ĐẮC", "失": "THẤT", "増": "TĂNG", "減": "GIẢM",
  "加": "GIA", "除": "TRỪ", "乗": "THỪA", "降": "HÀNG", "着": "TRƯỚC",
  "脱": "THOÁT", "送": "TỐNG", "受": "THỤ", "取": "THỦ", "渡": "ĐỘ",
  "使": "SỬ", "用": "DỤNG", "害": "HẠI", "助": "TRỢ",
  "想": "TƯỞNG"
};

/**
 * Get Sino-Vietnamese (Hán-Việt) reading for a Japanese string.
 * Returns space-separated Hán-Việt readings for kanji characters in text.
 */
export function getHanViet(text: string): string {
  if (!text) return "";
  const chars = [...text];
  const hanViets = chars
    .map(c => HANVIET_MAP[c])
    .filter(Boolean);

  if (hanViets.length === 0) return "";
  return hanViets.join(" ");
}
