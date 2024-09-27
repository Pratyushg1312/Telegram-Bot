require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const axios = require("axios");

// Telegram bot setup
const telegramToken = process.env.TELEGRAM_BOT_TOKEN; // Telegram Bot Token
const bot = new TelegramBot(telegramToken, { polling: true });

let accessToken = null;
let tokenExpiry = null; // Time when the access token expires

// User login credentials
let userCredentials = {
  user_login_id: "",
  user_login_password: "",
};

// Object to store scheduled reports for each user (now stores arrays of tasks)
let scheduledReports = {};

// Function to log in and obtain access token
async function login(chatId) {
  try {
    const response = await axios.post(
      "http://35.225.122.157:8080/api/login_user",
      userCredentials
    );

    accessToken = response.data.token; // Assuming the API responds with a token field
    tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // Set expiry to 24 hours (in milliseconds)
    console.log("Logged in and token acquired.");

    bot.sendMessage(
      chatId,
      "Login successful! You can now request sales reports. Here are your options:\n" +
        '- "Get sales report"\n' +
        '- "Get daily sales report"\n' +
        '- "Get weekly sales report"\n' +
        '- "Get monthly sales report"\n' +
        '- "Get quarterly sales report"\n' +
        '- "Schedule report {type} {HH:MM}" to schedule a report\n' +
        '- "Show scheduled reports" to view all scheduled reports\n' +
        '- "Delete scheduled report {task number}" to delete a scheduled report\n' +
        '- "/command" to see all available commands\n'
    );

    // Schedule next re-login after 24 hours
    setTimeout(() => {
      bot.sendMessage(chatId, "Reattempting login...");
      login(chatId); // Reattempt login every 24 hours
    }, 24 * 60 * 60 * 1000);
  } catch (error) {
    console.error(
      "Login failed:",
      error.response ? error.response.data : error.message
    );
    bot.sendMessage(
      chatId,
      "Login failed. Please check your credentials and try again."
    );
    userCredentials = {
      user_login_id: "",
      user_login_password: "",
    }; // Reset credentials after failed login
  }
}

// Function to check if the token is still valid
async function checkToken() {
  if (!accessToken || Date.now() >= tokenExpiry) {
    console.log("Token expired or missing, logging in again.");
    await login();
  }
}

// Greeting function
function greetUser(chatId) {
  const currentHour = new Date().getHours();
  let greeting;

  if (currentHour < 12) {
    greeting = "Good Morning!";
  } else if (currentHour < 18) {
    greeting = "Good Afternoon!";
  } else {
    greeting = "Good Evening!";
  }

  bot.sendMessage(
    chatId,
    `${greeting} Welcome! Type 'login' to start the login process.`
  );
}

// Function to get sales report
async function getSalesReport(chatId, filter) {
  await checkToken(); // Ensure token is valid before making API call

  axios
    .get(
      `http://35.225.122.157:8080/api/sales/sales_users_report_list${
        filter
          ? filter === "custom"
            ? `?filter=${filter}&&start_date=${fromDate}&&end_date=${toDate}`
            : `?filter=${filter}`
          : ""
      }`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    .then((response) => {
      const res = response?.data?.data;
      if (res.length !== 0) {
        for (let i = 0; i < res.length; i++) {
          let salesReport = res[i];
          const message = `
*Sales User Report for ${salesReport?.userName} (User ID: ${
            salesReport?.userId
          })*

- Total Sale Booking Counts: ${salesReport?.totalSaleBookingCounts}
- Total Campaign Amount: ₹${salesReport?.totalCampaignAmount.toFixed(2)}
- Total Base Amount: ₹${salesReport?.totalBaseAmount.toFixed(2)}
- Total GST Amount: ₹${salesReport?.totalGstAmount.toFixed(2)}
- Total Record Service Amount: ₹${salesReport?.totalRecordServiceAmount.toFixed(
            2
          )}
- Total Record Service Counts: ${salesReport?.totalRecordServiceCounts}
- Total Requested Amount: ₹${salesReport?.totalRequestedAmount.toFixed(2)}
- Total Approved Amount: ₹${salesReport?.totalApprovedAmount.toFixed(2)}
                  `;

          bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        }
      } else {
        bot.sendMessage(chatId, "No sales report found.");
      }
    })
    .catch((error) => {
      console.error(
        "API request failed:",
        error.response ? error.response.data : error.message
      );
      bot.sendMessage(chatId, "Failed to retrieve sales report.");
    });
}

// Other functions remain the same (scheduleReport, logout, showScheduledTasks, deleteScheduledTask, sendCommandList, etc.)

// Start the bot and listen for user messages
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim().toLowerCase(); // Normalize the text to avoid case issues

  if (text === "/start") {
    greetUser(chatId);
    return;
  }

  if (text === "/command") {
    sendCommandList(chatId);
    return;
  }

  if (text === "logout") {
    logout(chatId);
    return;
  }

  // Collect user credentials
  if (text === "login") {
    if (accessToken) {
      bot.sendMessage(
        chatId,
        "You are already logged in. Please logout to login again."
      );
      return;
    }
    userCredentials = {
      user_login_id: "",
      user_login_password: "",
    }; // Reset credentials before login
    bot.sendMessage(chatId, "Please provide your login ID:");
  } else if (userCredentials?.user_login_id === "") {
    userCredentials = {
      ...userCredentials,
      user_login_id: msg.text.trim(),
    }; // Store the login ID
    bot.sendMessage(chatId, "Please provide your password:");
  } else if (userCredentials?.user_login_password === "") {
    userCredentials = {
      ...userCredentials,
      user_login_password: msg.text.trim(),
    }; // Store the password
    login(chatId); // Attempt to log in with collected credentials
  } else {
    // Command handling after login
    if (text === "get quarterly sales report") {
      getSalesReport(chatId, "quarter");
    } else if (text === "get weekly sales report") {
      getSalesReport(chatId, "week");
    } else if (text === "get monthly sales report") {
      getSalesReport(chatId, "month");
    } else if (text === "get daily sales report") {
      getSalesReport(chatId, "today");
    } else if (text === "get sales report") {
      getSalesReport(chatId);
    } else if (text.startsWith("schedule report")) {
      const parts = text.split(" ");
      const reportType = parts[2]; // e.g., daily, weekly, monthly, quarterly
      const time = parts[3]; // e.g., "14:30"

      // Check if the report type and time are valid
      if (
        !["daily", "weekly", "monthly", "quarterly"].includes(reportType) ||
        !time.match(/^\d{2}:\d{2}$/)
      ) {
        bot.sendMessage(
          chatId,
          'Invalid command. Use the format: "Schedule report {type} {HH:MM}".'
        );
      } else {
        scheduleReport(chatId, reportType, time); // Schedule the report
      }
    } else if (text === "show scheduled reports") {
      showScheduledTasks(chatId); // Show all scheduled tasks
    } else if (text.startsWith("delete scheduled report")) {
      const parts = text.split(" ");
      const taskNumber = parseInt(parts[3], 10); // Get the task number from the command
      if (isNaN(taskNumber)) {
        bot.sendMessage(chatId, "Please provide a valid task number.");
      } else {
        deleteScheduledTask(chatId, taskNumber); // Delete the scheduled task
      }
    } else {
      bot.sendMessage(chatId, "Invalid command. Type '/command' for help.");
    }
  }
});
