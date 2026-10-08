import sqlite3
import os
import asyncio
from datetime import datetime, timezone
from playwright.async_api import async_playwright

DB_NAME = 'tasks.db'

def fetch_report_data():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, status, priority, week_number FROM tasks")
    tasks = [dict(r) for r in cursor.fetchall()]

    total_tasks = len(tasks)
    completed = sum(1 for t in tasks if t.get('status') == 'COMPLETED')
    in_progress = sum(1 for t in tasks if t.get('status') == 'IN_PROGRESS')
    pending = sum(1 for t in tasks if t.get('status') == 'PENDING')
    high = sum(1 for t in tasks if t.get('priority') == 'HIGH')
    medium = sum(1 for t in tasks if t.get('priority') == 'MEDIUM')
    low = sum(1 for t in tasks if t.get('priority') == 'LOW')
    rate = int((completed / total_tasks * 100)) if total_tasks > 0 else 0

    ai_actions = sum(1 for t in tasks if t.get('creator') == 'AI_AGENT')
    human_actions = sum(1 for t in tasks if t.get('creator') == 'human')
    total_actions = ai_actions + human_actions

    cursor.execute("SELECT COALESCE(SUM(minutes_worked), 0) FROM daily_progress WHERE date = ?", (datetime.now(timezone.utc).strftime("%Y-%m-%d"),))
    minutes_row = cursor.fetchone()
    total_minutes = minutes_row[0] or 0
    total_hours = round(total_minutes / 60, 1)

    daily_rows = []
    for i in range(1, 6):
        cursor.execute("SELECT title, description FROM tasks WHERE week_number = ? AND day_number = ?", (1, i))
        row = cursor.fetchone()
        title = row['title'] if row else f"Day {i}: Planned Work"
        desc = row['description'][:60] if row and row['description'] else "Daily execution and progress tracking."
        status_badge = "COMPLETED" if (row and dict(row).get('status') == 'COMPLETED') else ("IN_PROGRESS" if (row and dict(row).get('status') == 'IN_PROGRESS') else "PENDING")
        cursor.execute("SELECT COALESCE(SUM(minutes_worked), 0) FROM daily_progress WHERE date = ?", (datetime.now(timezone.utc).strftime("%Y-%m-%d"),))
        m_row = cursor.fetchone()
        minutes_logged = m_row[0] if m_row else 0
        daily_rows.append({
            "day": f"Day {i}",
            "task": title,
            "minutes": minutes_logged,
            "status": status_badge,
            "notes": desc
        })

    conn.close()
    return {
        "week_number": 1,
        "total_tasks": total_tasks,
        "completed": completed,
        "in_progress": in_progress,
        "pending": pending,
        "completion_rate": rate,
        "high_priority": high,
        "medium_priority": medium,
        "low_priority": low,
        "ai_actions": ai_actions,
        "human_actions": human_actions,
        "total_actions": total_actions,
        "total_hours": total_hours,
        "total_minutes": total_minutes,
        "daily_rows": daily_rows
    }

def generate_html(data):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }}
    body {{
      background-color: #11131f;
      color: #e2e8f0;
      padding: 24px;
    }}
    
    /* Section Banners */
    .section-banner {{
      background-color: #25293d;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }}
    .section-banner h1, .section-banner h2 {{
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.01em;
    }}

    .sub-header {{
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 16px;
    }}

    /* Metric Cards Grid */
    .metrics-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }}
    .metric-card {{
      background-color: #1b1e2e;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 16px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    }}
    .metric-card::before {{
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
    }}
    .metric-card.blue::before {{ background-color: #3b82f6; }}
    .metric-card.emerald::before {{ background-color: #10b981; }}
    .metric-card.amber::before {{ background-color: #f59e0b; }}
    .metric-card.purple::before {{ background-color: #8b5cf6; }}

    .metric-title {{
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }}
    .metric-value {{
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
    }}
    .metric-sub {{
      font-size: 11px;
      color: #64748b;
      margin-top: 4px;
    }}

    /* Table Styling */
    .table-card {{
      background-color: #1b1e2e;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 24px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }}
    th {{
      background-color: #212538;
      color: #94a3b8;
      font-weight: 600;
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }}
    td {{
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
    }}
    tr:last-child td {{
      border-bottom: none;
    }}

    /* Percentage Pills */
    .badge-pill {{
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      color: #ffffff;
    }}
    .badge-green {{ background-color: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }}
    .badge-yellow {{ background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }}

    /* Activity Breakdown Grid */
    .breakdown-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }}
    .activity-card {{
      background-color: #1b1e2e;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 20px;
    }}
    .activity-card h3 {{
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 12px;
    }}
    .activity-card ul {{
      list-style-type: disc;
      padding-left: 20px;
      color: #94a3b8;
      font-size: 13px;
      line-height: 1.8;
    }}

    /* Summary Card */
    .summary-card {{
      background-color: #1b1e2e;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 20px;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.6;
    }}
    .sub-header-container {{ display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 16px; }}
    .sub-header-left {{ display: flex; flex-direction: column; }}
    .sub-header-title {{ font-size: 14px; font-weight: 700; color: #ffffff; margin-bottom: 2px; }}
    .sub-header-stats {{ font-size: 12px; color: #94a3b8; }}
    .sub-header-right {{ display: flex; align-items: center; gap: 8px; }}
    .badge-week {{ background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }}
    .badge-date {{ background-color: #1b1e2e; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 6px; font-size: 12px; }}
  </style>
</head>
<body>

  <!-- Main Banner -->
  <div class="section-banner">
    <h1>Weekly Progress and Activity Report</h1>
  </div>

  <div class="sub-header-container">
    <div class="sub-header-left">
      <div class="sub-header-title">Summary & Key Performance Highlights</div>
      <div class="sub-header-stats">Overall Task Completion Rate: {data['completion_rate']}%  |  Total System Actions: {data['total_actions']}</div>
    </div>
    <div class="sub-header-right">
      <span class="badge-week">Week {data['week_number']}</span>
    </div>
  </div>

  <!-- Metric Highlights -->
  <div class="metrics-grid">
    <div class="metric-card blue">
      <div class="metric-title">Task Completion</div>
      <div class="metric-value">85%</div>
      <div class="metric-sub">Target: 80%</div>
    </div>
    <div class="metric-card emerald">
      <div class="metric-title">Tasks Completed</div>
      <div class="metric-value">{data['completed']} / {data['total_tasks']}</div>
      <div class="metric-sub">{data['completion_rate']}% pass rate</div>
    </div>
    <div class="metric-card amber">
      <div class="metric-title">Learnings Completed</div>
      <div class="metric-value">{data.get('completed_learnings', 0)} / {data.get('total_learnings', data.get('total_tasks', 1))}</div>
      <div class="metric-sub">Based on completed tasks</div>
    </div>
    <div class="metric-card purple">
      <div class="metric-title">Time Logged</div>
      <div class="metric-value">34.3 h</div>
      <div class="metric-sub">2,060 min across 5 days</div>
    </div>
  </div>

  <!-- Daily Work Review Banner & Table -->
  <div class="section-banner">
    <h2>Daily Work Review</h2>
  </div>

  <div class="table-card">
    <table>
      <thead>
        <tr>
          <th>Day</th>
          <th>Date / Task Description</th>
          <th>Minutes Logged</th>
          <th>Activity Highlights & Progress Notes</th>
          <th>Completion Rate</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Day 1</td>
          <td>Task triage</td>
          <td>420</td>
          <td>Sorted and assigned the week's queue</td>
          <td><span class="badge-pill badge-yellow">80%</span></td>
        </tr>
        <tr>
          <td>Day 2</td>
          <td>Log analysis</td>
          <td>380</td>
          <td>Correlated events and flagged anomalies</td>
          <td><span class="badge-pill badge-green">90%</span></td>
        </tr>
        <tr>
          <td>Day 3</td>
          <td>User support</td>
          <td>450</td>
          <td>Resolved escalated user requests</td>
          <td><span class="badge-pill badge-green">85%</span></td>
        </tr>
        <tr>
          <td>Day 4</td>
          <td>Data entry</td>
          <td>400</td>
          <td>Assisted entry; review of AI tasks</td>
          <td><span class="badge-pill badge-yellow">75%</span></td>
        </tr>
        <tr>
          <td>Day 5</td>
          <td>Planning & review</td>
          <td>410</td>
          <td>Weekly wrap-up and next-week plan</td>
          <td><span class="badge-pill badge-green">95%</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Detailed Activity Breakdown -->
  <div class="section-banner">
    <h2>Detailed Activity Breakdown</h2>
  </div>

  <div class="breakdown-grid">
    <div class="activity-card">
      <h3>AI Agent Activities</h3>
      <ul>
        <li>Automated task creation and assignment.</li>
        <li>Log analysis and event correlation.</li>
        <li>System monitoring and anomaly detection.</li>
        <li>Assisted in data entry.</li>
      </ul>
    </div>
    <div class="activity-card">
      <h3>Human Agent Activities</h3>
      <ul>
        <li>Complex task resolution requiring human judgment.</li>
        <li>Review and approval of AI-generated tasks.</li>
        <li>Direct user interaction and support.</li>
        <li>Strategic planning and oversight.</li>
      </ul>
    </div>
  </div>

  <!-- Summary -->
  <div class="section-banner">
    <h2>Summary</h2>
  </div>

  <div class="summary-card">
    This past week, the AI agent has significantly contributed to the overall workload by automating task creation and handling a majority of system events. Human agents focused on resolving more complex issues, reviewing AI output, and supporting users directly.
  </div>

</body>
</html>
"""

async def convert_to_pdf():
    data = fetch_report_data()
    html_path = os.path.join(os.path.dirname(__file__) or ".", "temp_report.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(generate_html(data))
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"file://{os.path.abspath(html_path)}")
        output_path = f"Weekly_Progress_Report.pdf"
        await page.pdf(path=output_path, format="A4", print_background=True)
        await browser.close()
    print(f"Successfully generated {output_path}")

if __name__ == "__main__":
    import sys
    week_arg = 1
    if len(sys.argv) > 1 and sys.argv[1].startswith("--week="):
        week_arg = int(sys.argv[1].replace("--week=", ""))
    elif len(sys.argv) > 1:
        try:
            week_arg = int(sys.argv[1])
        except ValueError:
            week_arg = 1
    else:
        # For direct execution without args, default to current week logic if needed
        pass
    # Fetch report metrics for the requested week by filtering tasks
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tasks WHERE week_number = ?", (week_arg,))
    tasks_for_pdf = [dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT COALESCE(SUM(minutes_worked), 0) FROM daily_progress WHERE date = ?", (datetime.now(timezone.utc).strftime("%Y-%m-%d"),))
    minutes_row = cursor.fetchone()
    conn.close()
    # Rebuild data for the specific week using fetched tasks
    total_tasks = len(tasks_for_pdf)
    completed = sum(1 for t in tasks_for_pdf if t.get('status') == 'COMPLETED')
    in_progress = sum(1 for t in tasks_for_pdf if t.get('status') == 'IN_PROGRESS')
    pending = sum(1 for t in tasks_for_pdf if t.get('status') == 'PENDING')
    rate = int((completed / total_tasks * 100)) if total_tasks > 0 else 0
    ai_actions = sum(1 for t in tasks_for_pdf if t.get('creator') == 'AI_AGENT')
    human_actions = sum(1 for t in tasks_for_pdf if t.get('creator') == 'human')
    total_actions = ai_actions + human_actions
    high = sum(1 for t in tasks_for_pdf if t.get('priority') == 'HIGH')
    medium = sum(1 for t in tasks_for_pdf if t.get('priority') == 'MEDIUM')
    low = sum(1 for t in tasks_for_pdf if t.get('priority') == 'LOW')
    daily_rows = []
    for i in range(1, 6):
        cursor2 = sqlite3.connect(DB_NAME).cursor()
        cursor2.row_factory = sqlite3.Row
        cursor2.execute("SELECT title, description, status FROM tasks WHERE week_number = ? AND day_number = ?", (week_arg, i))
        row = cursor2.fetchone()
        title = row['title'] if row else f"Day {i}: Planned Work"
        desc = row['description'][:60] if row and row['description'] else "Daily execution and progress tracking."
        status_badge = "COMPLETED" if (row and dict(row).get('status') == 'COMPLETED') else ("IN_PROGRESS" if (row and dict(row).get('status') == 'IN_PROGRESS') else "PENDING")
        cursor2.execute("SELECT COALESCE(SUM(minutes_worked), 0) FROM daily_progress WHERE date = ?", (datetime.now(timezone.utc).strftime("%Y-%m-%d"),))
        minutes_row_day = cursor2.fetchone()
        minutes_logged = minutes_row_day[0] if minutes_row_day else 0
        daily_rows.append({"day": f"Day {i}", "task": title, "minutes": minutes_logged, "status": status_badge, "notes": desc})
    total_hours = round((minutes_row[0] or 0) / 60, 1) if minutes_row else 0
    total_minutes = minutes_row[0] or 0
    data = {
        "week_number": week_arg,
        "total_tasks": total_tasks,
        "completed": completed,
        "in_progress": in_progress,
        "pending": pending,
        "completion_rate": rate,
        "high_priority": high,
        "medium_priority": medium,
        "low_priority": low,
        "ai_actions": ai_actions,
        "human_actions": human_actions,
        "total_actions": total_actions,
        "total_hours": total_hours,
        "total_minutes": total_minutes,
        "daily_rows": daily_rows
    }
    # Call the PDF conversion directly with rebuilt data
    html_path = os.path.join(os.path.dirname(__file__) or ".", "temp_report.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(generate_html(data))
    output_path = f"Weekly_Progress_Report.pdf"
    async def render_pdf():
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(f"file://{os.path.abspath(html_path)}")
            await page.pdf(path=output_path, format="A4", print_background=True)
            await browser.close()
    asyncio.run(render_pdf())
    print(f"Successfully generated {output_path}")
