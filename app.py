from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify
from flask_sqlalchemy import SQLAlchemy
import bcrypt
import json
from datetime import datetime
from google.oauth2 import service_account
from google.cloud import storage
from io import BytesIO
import os

app = Flask(__name__)
app.secret_key = "secret-1234-5678"

credentials_info = json.loads(os.environ["GOOGLE_CREDENTIALS"])
credentials = service_account.Credentials.from_service_account_info(credentials_info)
client = storage.Client(credentials=credentials)

app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class AdminUser(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)

    def check_password(self, password_plaintext):
        return bcrypt.checkpw(password_plaintext.encode('utf-8'), self.password_hash.encode('utf-8'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/questions')
def questions():
    with open('questions.json') as f:
        data = json.load(f)
    return jsonify(data)

@app.route('/submit', methods=['POST'])
def submit():
    submission = request.json
    submission['timestamp'] = datetime.utcnow().isoformat()
    filename = f"submission_{submission['timestamp'].replace(':', '-')}.json"

    # Save to Google Cloud Storage
    # client = storage.Client.from_service_account_json("credentials.json")
    credentials_info = json.loads(os.environ["GOOGLE_CREDENTIALS"])
    credentials = service_account.Credentials.from_service_account_info(credentials_info)
    client = storage.Client(credentials=credentials)
    bucket = client.bucket("ged-pretest-submission")
    blob = bucket.blob(f"submissions/{filename}")
    blob.upload_from_string(json.dumps(submission), content_type='application/json')

    return jsonify({"status": "success", "submitted": submission})

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        user = AdminUser.query.filter_by(username=username).first()

        if user and user.check_password(password):
            session["admin_logged_in"] = True
            return redirect(url_for("admin"))
        else:
            return render_template("login.html", error="Invalid credentials.")
    return render_template("login.html")

@app.route("/admin")
def admin():
    if not session.get("admin_logged_in"):
        return redirect(url_for("login"))

    client = storage.Client.from_service_account_json("credentials.json")
    bucket = client.bucket("ged-pretest-submission")

    blobs = bucket.list_blobs(prefix="submissions/")
    results = []

    for blob in blobs:
        if blob.name.endswith(".json"):
            meta = json.loads(blob.download_as_text())
            results.append({
                "name": meta.get("name"),
                "email": meta.get("email"),
                "filename": blob.name,
                "pdf_link": blob.name.replace(".json", ".pdf")  # if exists
            })

    return render_template("admin.html", results=results)

@app.route("/result/<path:filename>")
def view_result(filename):
    if not session.get("admin_logged_in"):
        return redirect(url_for("login"))

    client = storage.Client.from_service_account_json("credentials.json")
    bucket = client.bucket("ged-pretest-submission")
    blob = bucket.blob(filename)

    data = json.loads(blob.download_as_text())
    return render_template("student_result.html", result=data)

@app.route("/upload-report", methods=["POST"])
def upload_report():
    file = request.files["file"]
    filename = request.form["filename"]

    client = storage.Client.from_service_account_json("credentials.json")
    bucket = client.bucket("ged-pretest-submission")
    blob = bucket.blob(f"submissions/{filename}")
    blob.upload_from_file(file, content_type="application/pdf")

    return "Uploaded", 200


@app.route("/logout")
def logout():
    session.pop("admin_logged_in", None)
    return redirect(url_for("login"))


@app.route("/download/<path:filename>")
def download(filename):
    client = storage.Client.from_service_account_json("credentials.json")
    bucket = client.bucket("ged-pretest-submission")
    blob = bucket.blob(filename)

    buffer = BytesIO()
    blob.download_to_file(buffer)
    buffer.seek(0)

    return send_file(buffer, mimetype='application/json', download_name=os.path.basename(filename), as_attachment=True)
if __name__ == "__main__":
    app.run(debug=True)
