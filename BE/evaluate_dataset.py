"""Reproducible, train-only content-ridge evaluation on the supplied holdout."""
import argparse,json,math
from collections import defaultdict
from pathlib import Path
import numpy as np
from dataset_loader import check_dataset,training_statistics
from catalog_config import SOURCE_CATEGORIES
from recommendation_model import fit,vector


def evaluate():
    data,validation=check_dataset()
    if validation['errors']:raise ValueError(validation['errors'])
    dishes={int(d['dish_id']):dict(base_price=int(d['price_vnd']),categories=[SOURCE_CATEGORIES[d['category']]],main_ingredient=d['main_ingredient']) for d in data['dishes']}
    train_by_user=defaultdict(list);test_by_user=defaultdict(list)
    for row in data['ratings_train']:train_by_user[row['user_id']].append(row)
    for row in data['ratings_test']:test_by_user[row['user_id']].append(row)
    stats,mean=training_statistics();predictions=[];baselines=[];truth=[];ndcgs=[];recalls=[]
    for user,holdout in test_by_user.items():
        train=train_by_user[user];a,b=fit(train,dishes);theta=np.linalg.solve(a,b)
        for row in holdout:
            dish_id=int(row['dish_id']);truth.append(int(row['rating']))
            predictions.append(float(np.clip(3+2*(theta@vector(dishes[dish_id])),1,5)))
            baselines.append(stats.get(dish_id,{}).get('weighted',mean))
        # Rank only unseen candidates; relevance is observable only for held-out rows.
        seen={int(r['dish_id']) for r in train};candidates=[i for i in dishes if i not in seen]
        ranked=sorted(candidates,key=lambda i:-(theta@vector(dishes[i])))[:5]
        relevant={int(r['dish_id']) for r in holdout if int(r['rating'])>=4}
        if relevant:
            dcg=sum((i in relevant)/math.log2(pos+2) for pos,i in enumerate(ranked))
            ideal=sum(1/math.log2(pos+2) for pos in range(min(5,len(relevant))))
            ndcgs.append(dcg/ideal);recalls.append(len(set(ranked)&relevant)/len(relevant))
    def metrics(values):
        errors=np.array(values)-np.array(truth)
        return dict(mae=round(float(np.mean(np.abs(errors))),4),rmse=round(float(np.sqrt(np.mean(errors**2))),4))
    return dict(validation=validation,method='Content ridge; cùng đặc trưng với LinUCB, không phải đánh giá trực tiếp chính sách online',training_rows=366,holdout_rows=len(truth),features=len(vector(next(iter(dishes.values())))),model=metrics(predictions),baseline_train_popularity=metrics(baselines),ranking_at_5=dict(ndcg=round(float(np.mean(ndcgs)),4),recall=round(float(np.mean(recalls)),4),users_with_positive_holdout=len(recalls)),limitations=['Chỉ 40 người dùng nguồn và 25 món; không đại diện người dùng thật.', 'Chỉ ratings_train được dùng để học và tính phổ biến; ratings_test chỉ chấm điểm.', 'Món chưa được đánh giá trong holdout được tính không liên quan khi tính ranking; đây là thước đo hạn chế trên dữ liệu thưa.', 'Điểm RMSE/MAE không đo khả năng hội thoại. Trợ lý local vẫn là tư vấn theo dữ liệu, chưa phải LLM.', 'LinUCB online học từ tương tác tài khoản thật; thử nghiệm offline dùng ridge để dự đoán sao và không có vòng phản hồi online.'])

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='../docs/DANH-GIA-DU-LIEU.json');args=parser.parse_args()
    report=evaluate();path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    text='# Đánh giá dữ liệu món ăn và gợi ý\n\nNguồn: BE/data/dishes.csv, ratings_train.csv, ratings_test.csv, ratings_all.csv và test_cases.csv do người dùng cung cấp.\n\n'
    text+=f"25 món, 40 người dùng nguồn, 474 đánh giá. Tập học 366 dòng; holdout {report['holdout_rows']} dòng; không trùng cặp người–món.\n\n"
    text+='| Phương pháp | MAE (sao) | RMSE (sao) |\n|---|---:|---:|\n'
    for name,key in [('Content ridge','model'),('Mức phổ biến từ train','baseline_train_popularity')]:text+=f"| {name} | {report[key]['mae']} | {report[key]['rmse']} |\n"
    rank=report['ranking_at_5'];text+=f"\nNDCG@5: {rank['ndcg']}; Recall@5: {rank['recall']} trên {rank['users_with_positive_holdout']} người có món holdout từ 4 sao.\n\n"
    text+='\n'.join('- '+line for line in report['limitations'])+'\n'
    path.with_suffix('.md').write_text(text,encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['limitations','validation']},ensure_ascii=True))
