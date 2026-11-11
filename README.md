# t-prj-app

戦略の入れ物の画面だけを置く公開リポジトリ（GitHub Pages 用）。データは含まない。データは非公開リポジトリ secondary-investment の data/ にあり、画面が GitHub の API で読み、入力は data/入力/人の入力/ に1件1ファイルで書く。

画面の元は secondary-investment の app/（作りは app/README.md、仕様は 戦略の入れ物/画面の方針.md）。更新は secondary-investment の根で `sh tools/deploy_app.sh`。
