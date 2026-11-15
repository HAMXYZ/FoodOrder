# Đánh giá dữ liệu món ăn và gợi ý

Nguồn: BE/data/dishes.csv, ratings_train.csv, ratings_test.csv, ratings_all.csv và test_cases.csv do người dùng cung cấp.

25 món, 40 người dùng nguồn, 474 đánh giá. Tập học 366 dòng; holdout 108 dòng; không trùng cặp người–món.

| Phương pháp | MAE (sao) | RMSE (sao) |
|---|---:|---:|
| Content ridge | 0.7933 | 1.0142 |
| Mức phổ biến từ train | 0.72 | 0.9139 |

NDCG@5: 0.1729; Recall@5: 0.3046 trên 29 người có món holdout từ 4 sao.

- Chỉ 40 người dùng nguồn và 25 món; không đại diện người dùng thật.
- Chỉ ratings_train được dùng để học và tính phổ biến; ratings_test chỉ chấm điểm.
- Món chưa được đánh giá trong holdout được tính không liên quan khi tính ranking; đây là thước đo hạn chế trên dữ liệu thưa.
- Điểm RMSE/MAE không đo khả năng hội thoại. Trợ lý local vẫn là tư vấn theo dữ liệu, chưa phải LLM.
- LinUCB online học từ tương tác tài khoản thật; thử nghiệm offline dùng ridge để dự đoán sao và không có vòng phản hồi online.
