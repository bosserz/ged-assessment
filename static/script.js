let time = 20 * 60;
let student = {};

// Handle user info form
document.getElementById("userForm").addEventListener("submit", function (e) {
  e.preventDefault();
  student.name = document.getElementById("name").value.trim();
  student.email = document.getElementById("email").value.trim();

  if (!student.name || !student.email) return;

  document.getElementById("userSection").style.display = "none";
  document.getElementById("testSection").style.display = "block";
  loadQuestions();
  startTimer();
});

function startTimer() {
  const timer = setInterval(() => {
    if (time <= 0) {
      clearInterval(timer);
      document.getElementById("testForm").requestSubmit();
    } else {
      const minutes = Math.floor(time / 60);
      const seconds = time % 60;
      document.getElementById("time").textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
      time--;
    }
  }, 1000);
}

function loadQuestions() {
  fetch("/questions")
    .then((res) => res.json())
    .then((data) => {
      const container = document.getElementById("questionsContainer");
      data.forEach((q, idx) => {
        const qDiv = document.createElement("div");
        qDiv.classList.add("question-block");
        qDiv.innerHTML = `
          <p class="fw-bold">Q${idx + 1}: ${q.question}</p>
          <div class="ms-3">
            ${q.options
              .map(
                (opt) => `
              <div class="form-check">
                <input class="form-check-input" type="radio" name="${q.id}" value="${opt}" required>
                <label class="form-check-label">${opt}</label>
              </div>
            `
              )
              .join("")}
          </div>
        `;
        container.appendChild(qDiv);
      });
    });
}

document.getElementById("testForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const formData = new FormData(this);
  const userAnswers = Object.fromEntries(formData.entries());

  const res = await fetch("/questions");
  const questions = await res.json();

  let score = 0;
  let total = questions.length;
  let tagStats = {};
  let feedbackHTML = "";
  let feedbackData = [];

  questions.forEach((q, idx) => {
    const userAnswer = userAnswers[q.id] || "Not answered";
    const isCorrect = userAnswer === q.answer;

    if (isCorrect) score++;

    q.tags.forEach((tag) => {
      if (!tagStats[tag]) tagStats[tag] = { correct: 0, total: 0 };
      tagStats[tag].total += 1;
      if (isCorrect) tagStats[tag].correct += 1;
    });

    feedbackData.push({
      question: q.question,
      userAnswer: userAnswer,
      correctAnswer: q.answer,
      isCorrect: isCorrect,
      tags: q.tags
    });

    feedbackHTML += `
      <div class="mb-3">
        <strong>Q${idx + 1}: ${q.question}</strong><br/>
        Your answer: <span class="${isCorrect ? 'text-success' : 'text-danger'}">${userAnswer}</span><br/>
        Correct answer: <span class="text-primary">${q.answer}</span><br/>
        <small class="text-muted">Skills: ${q.tags.join(", ")}</small>
      </div>
    `;
  });

  const weakSkills = Object.entries(tagStats)
    .filter(([_, stat]) => stat.correct / stat.total < 0.6)
    .map(([tag]) => tag);

  // ✅ Set test result for PDF generation
  window.testResult = {
    name: student.name,
    email: student.email,
    score,
    total,
    tagStats,
    weakSkills,
    feedback: feedbackData
  };

  // Render result to page
  document.getElementById("testForm").style.display = "none";
  document.getElementById("timer").style.display = "none";
  document.getElementById("result").classList.remove("d-none");

  document.getElementById("resultSummary").innerHTML = `
    <p><strong>Name:</strong> ${student.name}</p>
    <p><strong>Email:</strong> ${student.email}</p>
    <p><strong>Total Score:</strong> ${score} / ${total}</p>
    <p><strong>Skills Needing Improvement:</strong> ${
      weakSkills.length ? weakSkills.join(", ") : "None 🎉"
    }</p>
    <p><strong>Score by Skill:</strong></p>
    <ul>
      ${Object.entries(tagStats)
        .map(([tag, stat]) => `<li>${tag}: ${stat.correct}/${stat.total}</li>`)
        .join("")}
    </ul>
  `;

  document.getElementById("resultFeedback").innerHTML = feedbackHTML;

  // Save result JSON to GCS
  await fetch("/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(window.testResult),
  });
});

  document.getElementById("downloadPdf").addEventListener("click", async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let y = 10;
    doc.setFontSize(12);
    doc.text(`GED English Test Result`, 10, y += 10);
    doc.text(`Name: ${student.name}`, 10, y += 10);
    doc.text(`Email: ${student.email}`, 10, y += 10);
    doc.text(`Total Score: ${window.testResult.score} / ${window.testResult.total}`, 10, y += 10);

    doc.text(`Skills Needing Improvement: ${window.testResult.weakSkills.length ? window.testResult.weakSkills.join(", ") : "None"}`, 10, y += 10);

    doc.text("Score by Skill:", 10, y += 10);
    Object.entries(window.testResult.tagStats).forEach(([tag, stat]) => {
        doc.text(`- ${tag}: ${stat.correct}/${stat.total}`, 12, y += 10);
    });

    y += 10;
    doc.setFont("Helvetica", "bold");
    doc.text("Question Breakdown:", 10, y);
    doc.setFont("Helvetica", "normal");

    window.testResult.feedback.forEach((q, i) => {
        const block = [
        `Q${i + 1}: ${q.question}`,
        `Your answer: ${q.userAnswer} ${q.isCorrect ? '(Correct)' : '(Incorrect)'}`,
        `Correct answer: ${q.correctAnswer}`,
        `Skills: ${q.tags.join(", ")}`,
        ];

        block.forEach(line => {
        if (y > 280) {
            doc.addPage();
            y = 10;
        }
        doc.text(line, 10, y += 8);
        });

        y += 4;
    });

    // Save locally
    const filename = `GED_Result_${student.name.replace(" ", "_")}.pdf`;
    doc.save(filename);

    // Upload to backend
    const blob = doc.output("blob");
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("student_name", student.name);
    formData.append("student_email", student.email);
    formData.append("filename", filename);

    await fetch("/upload-report", {
        method: "POST",
        body: formData,
    });
    });
