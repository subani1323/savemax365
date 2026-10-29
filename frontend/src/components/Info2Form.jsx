import React, { useEffect, useState } from "react";
import axiosInstance from "../config/axios";

/** Format SIN as XXX-XXX-XXX (max 9 digits). */
function formatSinInput(value) {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const Info2Form = ({
  licenses,
  setLicenses,
  handleSubmit,
  combinedFormData,
  setCombinedFormData,
  setActiveTab,
}) => {
  const [hstNumber, setHstNumber] = useState(
    combinedFormData.basicInfo?.hstNumber || ""
  );
  const [sin, setSin] = useState(
    formatSinInput(combinedFormData.basicInfo?.sin || "")
  );

  // Helper function to format date for input type="date" (needs YYYY-MM-DD format)
  const formatDateForInput = (dateString) => {
    if (!dateString) return "";
    
    // If already in YYYY-MM-DD format, return as is
    if (typeof dateString === "string" && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateString;
    }
    
    // If in DD/MM/YYYY format, convert to YYYY-MM-DD
    if (typeof dateString === "string" && dateString.includes("/")) {
      const parts = dateString.split("/");
      if (parts.length === 3) {
        const [day, month, year] = parts;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }
    }
    
    // Try to parse as Date object or ISO string
    try {
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
    } catch (e) {
      console.error("Error formatting date:", e);
    }
    
    return "";
  };

  useEffect(() => {
    // First, check if combinedFormData has license info and use that
    if (
      combinedFormData.licenseInfo &&
      combinedFormData.licenseInfo.length > 0
    ) {
      setLicenses(combinedFormData.licenseInfo);
    } else if ((!licenses || licenses.length === 0) && setLicenses) {
      // Only create empty license if no licenses exist and no data from combinedFormData
      setLicenses([
        {
          licenseNumber: "",
          licenseType: "",
          issueDate: "",
          expiryDate: "",
          status: "Active",
        },
      ]);
    }
    // Update HST / SIN when combined form data changes
    if (combinedFormData.basicInfo?.hstNumber !== undefined) {
      setHstNumber(combinedFormData.basicInfo.hstNumber);
    }
    if (combinedFormData.basicInfo?.sin !== undefined) {
      setSin(formatSinInput(combinedFormData.basicInfo.sin));
    }
    // eslint-disable-next-line
  }, [
    combinedFormData.licenseInfo,
    combinedFormData.basicInfo?.hstNumber,
    combinedFormData.basicInfo?.sin,
  ]);

  const handleLicenseChange = async (index, field, value) => {
    const updatedLicenses = [...licenses];
    updatedLicenses[index][field] = value;
    setLicenses(updatedLicenses);

    // Check if expiry date is being set and create reminder if needed
    if (field === "expiryDate" && value) {
      await checkAndCreateReminder(value, updatedLicenses[index]);
    }
  };

  const checkAndCreateReminder = async (expiryDate, license) => {
    try {
      const expiry = new Date(expiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day for accurate comparison
      expiry.setHours(0, 0, 0, 0);
      
      const daysUntilExpiry = Math.ceil(
        (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Get agent name from combinedFormData
      const firstName = combinedFormData.basicInfo?.firstName || "";
      const lastName = combinedFormData.basicInfo?.lastName || "";
      const agentName = firstName && lastName 
        ? `${firstName} ${lastName}'s` 
        : firstName 
        ? `${firstName}'s` 
        : lastName 
        ? `${lastName}'s` 
        : "";

      // Only create reminder if expiry is 60 days or less away
      if (daysUntilExpiry <= 60 && daysUntilExpiry >= 0) {
        // First, check for and delete any existing reminders for this agent's license
        try {
          const existingReminders = await axiosInstance.get("/reminders");
          const agentFullName = firstName && lastName 
            ? `${firstName} ${lastName}` 
            : firstName || lastName || "";
          
          if (agentFullName) {
            // Find and delete existing reminders for this agent
            for (const reminder of existingReminders.data) {
              if (reminder.reminder && reminder.reminder.includes(`${agentFullName}'s License will expire`)) {
                try {
                  await axiosInstance.delete(`/reminders/${reminder._id}`);
                  console.log("Deleted existing reminder for agent:", agentFullName);
                } catch (deleteError) {
                  console.log("Error deleting existing reminder:", deleteError);
                }
              }
            }
          }
        } catch (fetchError) {
          console.log("Error fetching existing reminders:", fetchError);
        }

        // Determine reminder date and text
        let dateToSend;
        let reminderText;

        if (daysUntilExpiry >= 60) {
          // Create reminder for the date that is 60 days before expiry
          const reminderDate = new Date(expiry);
          reminderDate.setDate(reminderDate.getDate() - 60);
          
          // Format reminder date as DD/MM/YYYY
          const day = String(reminderDate.getDate()).padStart(2, "0");
          const month = String(reminderDate.getMonth() + 1).padStart(2, "0");
          const year = reminderDate.getFullYear();
          dateToSend = `${day}/${month}/${year}`;

          // Create reminder text in format: "FirstName LastName's License will expire in 60 days"
          reminderText = agentName 
            ? `${agentName} License will expire in 60 days`
            : `License will expire in 60 days`;
        } else {
          // If expiry is less than 60 days away, create reminder for today
          const day = String(today.getDate()).padStart(2, "0");
          const month = String(today.getMonth() + 1).padStart(2, "0");
          const year = today.getFullYear();
          dateToSend = `${day}/${month}/${year}`;

          // Create reminder text in format: "FirstName LastName's License will expire in X days"
          reminderText = agentName 
            ? `${agentName} License will expire in ${daysUntilExpiry} days`
            : `License will expire in ${daysUntilExpiry} days`;
        }

        // Create the new reminder
        try {
          await axiosInstance.post("/reminders", {
            date: dateToSend,
            reminder: reminderText,
          });
          console.log("Reminder created successfully for license expiry");
        } catch (error) {
          console.log("Reminder creation skipped:", error.response?.data?.message || error.message);
        }
      }
    } catch (error) {
      console.error("Error checking expiry date:", error);
    }
  };

  const addLicense = () => {
    setLicenses([
      ...licenses,
      {
        licenseNumber: "",
        licenseType: "",
        issueDate: "",
        expiryDate: "",
        status: "Active",
      },
    ]);
  };

  return (
    <div className="max-w-6xl mx-auto bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-xl font-bold mb-6">Additional Information</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            HST #
          </label>
          <input
            type="text"
            value={hstNumber}
            onChange={(e) => {
              setHstNumber(e.target.value);
              // Update the combined form data
              setCombinedFormData((prev) => ({
                ...prev,
                basicInfo: {
                  ...prev.basicInfo,
                  hstNumber: e.target.value,
                },
              }));
            }}
            className="w-full p-2 border rounded-md"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            SIN
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="XXX-XXX-XXX"
            maxLength={11}
            value={sin}
            onChange={(e) => {
              const formatted = formatSinInput(e.target.value);
              setSin(formatted);
              setCombinedFormData((prev) => ({
                ...prev,
                basicInfo: {
                  ...prev.basicInfo,
                  sin: formatted,
                },
              }));
            }}
            className="w-full p-2 border rounded-md"
          />
          <p className="mt-1 text-xs text-gray-500">9 digits with dashes</p>
        </div>
      </div>

      <h3 className="text-xl font-bold mb-6">License Information</h3>
      {licenses.map((license, index) => (
        <div key={index} className="mb-8 p-4 border rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                License Number
              </label>
              <input
                type="text"
                value={license.licenseNumber}
                onChange={(e) =>
                  handleLicenseChange(index, "licenseNumber", e.target.value)
                }
                className="w-full p-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                License Type
              </label>
              <select
                value={license.licenseType}
                onChange={(e) =>
                  handleLicenseChange(index, "licenseType", e.target.value)
                }
                className="w-full p-2 border rounded-md"
              >
                <option value="">Select License Type</option>
                <option value="Real Estate Agent">Real Estate Agent</option>
                <option value="Broker">Broker</option>
                <option value="Property Manager">Property Manager</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issue Date
              </label>
              <input
                type="date"
                value={formatDateForInput(license.issueDate)}
                onChange={(e) =>
                  handleLicenseChange(index, "issueDate", e.target.value)
                }
                className="w-full p-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expiry Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formatDateForInput(license.expiryDate)}
                onChange={(e) =>
                  handleLicenseChange(index, "expiryDate", e.target.value)
                }
                required
                className="w-full p-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={license.status}
                onChange={(e) =>
                  handleLicenseChange(index, "status", e.target.value)
                }
                className="w-full p-2 border rounded-md"
              >
                <option value="Active">Active</option>
                <option value="Expired">Expired</option>
                <option value="Suspended">Suspended</option>
                <option value="Pending">Pending</option>
              </select>
            </div>
          </div>
        </div>
      ))}
      <div className="flex justify-between mt-4">
        <button
          type="button"
          onClick={addLicense}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Add License
        </button>
        {/* Save button removed - only main Save Changes button will be used */}
      </div>
    </div>
  );
};

export default Info2Form;
