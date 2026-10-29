import React, { useState, useEffect } from "react";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import EFTReceipt from "./EFTReceipt";
import toast from "react-hot-toast";
import {
  checkRealEstateTrustEFT,
  getEFTTypeDisplayName,
  formatDate,
  getPartyNamesByDealType,
  isTradeVoided,
} from "../utils/eftUtils";
import axiosInstance from "../config/axios";

const RealEstateTrustPayments = () => {
  const [activeSection, setActiveSection] = useState("main");
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [showTradeDropdown, setShowTradeDropdown] = useState(false);
  const [showTradeDropdown2, setShowTradeDropdown2] = useState(false);
  const [showDetailsForm, setShowDetailsForm] = useState(false);
  const [showBalanceDetails, setShowBalanceDetails] = useState(false);
  const [showRefundDetails, setShowRefundDetails] = useState(false);
  const [showEFTReceipt, setShowEFTReceipt] = useState(false);
  const [eftNumber, setEftNumber] = useState(null);
  const [eftReceiptData, setEftReceiptData] = useState(null);

  // Add state to track EFT creation status
  const [eftCreated, setEftCreated] = useState({
    commissionTransfer: false,
    balanceOfDeposit: false,
    refundOfDeposit: false,
  });

  // Commission Transfer form state
  const [commissionForm, setCommissionForm] = useState({
    chequeType: "Transfer to General/Commission Trust",
    tradeNumber: "",
    selectedTrade: null,
  });

  // Balance of Deposit form state
  const [balanceForm, setBalanceForm] = useState({
    chequeType: "Balance of Deposit",
    tradeNumber: "",
    selectedTrade: null,
  });

  // Refund of Deposit form state
  const [refundForm, setRefundForm] = useState({
    chequeType: "Refund of Deposit",
    tradeNumber: "",
    selectedTrade: null,
  });

  // Fetch trades on component mount
  useEffect(() => {
    fetchTrades();
  }, []);

  const fetchTrades = async () => {
    try {
      const response = await axiosInstance.get("/trades");
      setTrades(response.data);
    } catch (error) {
      console.error("Error fetching trades:", error);
    }
  };

  // Handle trade number search for commission transfer
  const handleCommissionTradeSearch = (searchTerm) => {
    setCommissionForm((prev) => ({ ...prev, tradeNumber: searchTerm }));

    if (searchTerm.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }

    const filtered = trades.filter(
      (trade) =>
        (trade.tradeNumber != null ? String(trade.tradeNumber) : "").includes(searchTerm) ||
        `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase())
    );

    setFilteredTrades(filtered);
    setShowTradeDropdown(true);
  };

  // Handle trade number search for balance of deposit
  const handleBalanceTradeSearch = (searchTerm) => {
    setBalanceForm((prev) => ({ ...prev, tradeNumber: searchTerm }));

    if (searchTerm.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown2(false);
      return;
    }

    const filtered = trades.filter(
      (trade) =>
        (trade.tradeNumber != null ? String(trade.tradeNumber) : "").includes(searchTerm) ||
        `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase())
    );

    setFilteredTrades(filtered);
    setShowTradeDropdown2(true);
  };

  // Handle trade number search for refund of deposit
  const handleRefundTradeSearch = (searchTerm) => {
    setRefundForm((prev) => ({ ...prev, tradeNumber: searchTerm }));

    if (searchTerm.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }

    const filtered = trades.filter(
      (trade) =>
        (trade.tradeNumber != null ? String(trade.tradeNumber) : "").includes(searchTerm) ||
        `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase())
    );

    setFilteredTrades(filtered);
    setShowTradeDropdown(true);
  };

  // Select trade from dropdown for commission transfer
  const selectCommissionTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      // Check if Commission Transfer EFT already exists for this trade
      const existingEFT = await checkRealEstateTrustEFT(
        trade._id,
        "CommissionTransfer"
      );
      if (existingEFT.exists) {
        toast.error(
          `Payment already completed for Trade #${trade.tradeNumber}!\nEFT #${
            existingEFT.eftNumber
          } was created on ${formatDate(
            existingEFT.date
          )} for ${getEFTTypeDisplayName(existingEFT.type)}.`,
          { duration: 6000 }
        );
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, commissionTransfer: true }));
        return;
      }
      setCommissionForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: trade,
      }));
      setShowTradeDropdown(false);
    } catch (error) {
      console.error("Error checking existing EFT:", error);
      toast.error("Could not verify existing payments. Please try again.");
    }
  };

  // Select trade from dropdown for balance of deposit
  const selectBalanceTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      // Check if Balance of Deposit EFT already exists for this trade
      const existingEFT = await checkRealEstateTrustEFT(
        trade._id,
        "BalanceOfDeposit"
      );
      if (existingEFT.exists) {
        toast.error(
          `Payment already completed for Trade #${trade.tradeNumber}!\nEFT #${
            existingEFT.eftNumber
          } was created on ${formatDate(
            existingEFT.date
          )} for ${getEFTTypeDisplayName(existingEFT.type)}.`,
          { duration: 6000 }
        );
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, balanceOfDeposit: true }));
        return;
      }
      setBalanceForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: trade,
      }));
      setShowTradeDropdown2(false);
    } catch (error) {
      console.error("Error checking existing EFT:", error);
      toast.error("Could not verify existing payments. Please try again.");
    }
  };

  // Select trade from dropdown for refund of deposit
  const selectRefundTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      // Check if Refund of Deposit EFT already exists for this trade
      const existingEFT = await checkRealEstateTrustEFT(
        trade._id,
        "RefundOfDeposit"
      );
      if (existingEFT.exists) {
        toast.error(
          `Payment already completed for Trade #${trade.tradeNumber}!\nEFT #${
            existingEFT.eftNumber
          } was created on ${formatDate(
            existingEFT.date
          )} for ${getEFTTypeDisplayName(existingEFT.type)}.`,
          { duration: 6000 }
        );
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, refundOfDeposit: true }));
        return;
      }
      setRefundForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: trade,
      }));
      setShowTradeDropdown(false);
      setShowRefundDetails(true);
    } catch (error) {
      console.error("Error checking existing EFT:", error);
      toast.error("Could not verify existing payments. Please try again.");
    }
  };

  // Handle commission transfer form submission
  const handleCommissionSubmit = (e) => {
    e.preventDefault();
    if (commissionForm.selectedTrade) {
      console.log("Commission Transfer Form Data:", commissionForm);
      setShowDetailsForm(true);
    } else {
      alert("Please select a trade to proceed.");
    }
  };

  const handleCommissionEFTClick = async (formState) => {
    if (!commissionForm.selectedTrade) {
      alert("No trade selected.");
      return;
    }
    const trade = commissionForm.selectedTrade;
    const totalCommission =
      trade.commission?.commissionIncomeRows?.reduce(
        (sum, row) => sum + parseFloat(row.total || 0),
        0
      ) || 0;

    const trustAmount =
      trade.trustRecords?.reduce(
        (sum, record) => sum + parseFloat(record.amount || 0),
        0
      ) || 0;

    // If trust amount is less than total commission, use trust amount as cheque amount
    const chequeAmount =
      trustAmount < totalCommission ? trustAmount : totalCommission;

    try {
      const eftResponse = await axiosInstance.post(
        "/real-estate-trust-eft/commission-transfer",
        {
          tradeId: trade._id,
          amount: chequeAmount,
          recipient: "365 Realty Brokerage - Commission Trust",
          chequeDate: formState.chequeDate,
        }
      );

      if (eftResponse.data.eftNumber) {
        // Now, create the transaction record
        try {
          // Convert MM/DD/YYYY to proper date format
          const [month, day, year] = formState.chequeDate.split("/");
          const transactionDate = new Date(
            `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`
          );

          await axiosInstance.post("/transactions", {
            date: transactionDate,
            reference: `EFT#${eftResponse.data.eftNumber}`,
            description: "Transfer funds to Commission Trust",
            debitAccount: "CASH - COMMISSION TRUST ACCOUNT",
            creditAccount: "CASH - TRUST",
            amount: chequeAmount,
            tradeId: trade._id,
          });

          // Also save to finance transactions
          await axiosInstance.post("/finance-transactions", {
            type: "CommissionTransfer",
            chequeDate: transactionDate,
            amount: chequeAmount,
            chequeWrittenTo: "365 Realty Brokerage",
            tradeId: trade._id,
            description: "Transfer funds to Commission Trust",
          });

          // Record in ledger for trial balance
          const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
            trade.keyInfo?.streetName || ""
          }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
          
          // Get city, province, postal code if available
          const city = trade.keyInfo?.city || "";
          const province = trade.keyInfo?.province || "";
          const postalCode = trade.keyInfo?.postalCode || "";
          
          // Construct full address string
          let fullAddress = tradeAddress;
          if (city || province || postalCode) {
            const addressParts = [city, province, postalCode].filter(Boolean);
            if (addressParts.length > 0) {
              fullAddress = `${tradeAddress} ${addressParts.join(" ")}`;
            }
          }
          
          const eftDescription =
            trade.tradeNumber != null
              ? `Transfer to Commission Trust - Trade #${trade.tradeNumber} ${fullAddress}`.trim()
              : `Transfer to Commission Trust - ${fullAddress}`.trim() || "Transfer to Commission Trust";

          await axiosInstance.post("/ledger/eft-transfer", {
            eftNumber: eftResponse.data.eftNumber,
            description: eftDescription,
            amount: chequeAmount,
            chequeDate: transactionDate,
          });

          toast.success(
            "Transaction posted to Chart of Accounts and Ledger successfully!"
          );
        } catch (transactionError) {
          console.error("Error creating transaction:", transactionError);
          // Handle transaction error separately if needed, e.g., show a specific message
          alert(
            "EFT number generated, but failed to create the transaction record."
          );
        }

        const partyNames = getPartyNamesByDealType(trade);
        const sellers = partyNames.firstParty;
        const buyers = partyNames.secondParty;
        const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

        const dataForReceipt = {
          eftNumber: eftResponse.data.eftNumber,
          paidTo: {
            name: "365 Realty Brokerage - Commission Trust",
            address: "66 Antibes Dr",
          },
          trade: tradeAddress,
          notes: "TRANSFER FUNDS TO COMMISSION TRUST (From: Trust)",
          amount: chequeAmount,
          seller: sellers,
          buyer: buyers,
          firstPartyLabel: partyNames.firstPartyLabel,
          secondPartyLabel: partyNames.secondPartyLabel,
          payTo: "365 Realty Brokerage - Commission Trust",
          orderOf: {
            address: "66 Antibes Dr",
            cityProvincePostal: "Brampton Ontario L6X 5H5",
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
          chequeDate: formState.chequeDate,
        };

        setEftReceiptData(dataForReceipt);
        setEftNumber(eftResponse.data.eftNumber);
        setShowEFTReceipt(true);
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, commissionTransfer: true }));
      } else {
        alert("Failed to get EFT number.");
      }
    } catch (error) {
      console.error("Error creating EFT record:", error);
      alert("Error creating EFT record. Please check the console for details.");
    }
  };

  // Handle balance of deposit form submission
  const handleBalanceSubmit = (e) => {
    e.preventDefault();
    if (balanceForm.selectedTrade) {
      setShowBalanceDetails(true);
    } else {
      alert("Please select a trade to proceed.");
    }
  };

  const handleBalanceEFTClick = async (formState) => {
    if (!balanceForm.selectedTrade) {
      alert("No trade selected.");
      return;
    }
    let trade = balanceForm.selectedTrade;
    try {
      const { data } = await axiosInstance.get(`/trades/${trade._id}`);
      trade = data;
    } catch (err) {
      console.error("Could not refresh trade before Balance EFT:", err);
    }

    const trustAmount =
      trade.trustRecords?.reduce(
        (sum, record) => sum + parseFloat(record.amount || 0),
        0
      ) || 0;
    const commissionTotal =
      trade.commission?.commissionIncomeRows?.reduce(
        (sum, row) => sum + parseFloat(row.total || 0),
        0
      ) || 0;
    const balance = trustAmount - commissionTotal;

    // Get all seller names from the trade
    const partyNames = getPartyNamesByDealType(trade);
    const sellers = partyNames.firstParty;
    const sellerName = sellers || "N/A";

    try {
      const response = await axiosInstance.post(
        "/real-estate-trust-eft/balance-deposit",
        {
          tradeId: trade._id,
          amount: balance,
          recipient: sellers,
          description: formState.noteOnStub,
          chequeDate: formState.chequeDate,
        }
      );

      if (response.data.eftNumber) {
        const description = `Trade #: ${trade.tradeNumber}, Paid to: ${sellers}`;

        // Convert MM/DD/YYYY to proper date format
        const [month, day, year] = formState.chequeDate.split("/");
        const transactionDate = new Date(
          `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`
        );

        // 1. Post to transactions
        await axiosInstance.post("/transactions", {
          date: transactionDate,
          reference: `EFT#${response.data.eftNumber}`,
          description,
          debitAccount: "LIABILITY FOR TRUST FUNDS HELD",
          creditAccount: "CASH - TRUST",
          amount: balance,
          tradeId: trade._id,
        });

        // 2. Post to finance transactions (optional)
        await axiosInstance.post("/finance-transactions", {
          type: "BalanceOfDeposit",
          chequeDate: transactionDate,
          amount: balance,
          chequeWrittenTo: sellers,
          tradeId: trade._id,
        });

        toast.success(
          "Transaction posted to Chart of Accounts and Ledger successfully!"
        );
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("refreshTrialBalance"));
        }
        const buyers = partyNames.secondParty;
        const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

        const dataForReceipt = {
          eftNumber: response.data.eftNumber,
          paidTo: {
            name: sellers,
            address: formState.address,
          },
          trade: tradeAddress,
          notes: formState.noteOnStub,
          amount: balance,
          seller: sellers,
          buyer: buyers,
          firstPartyLabel: partyNames.firstPartyLabel,
          secondPartyLabel: partyNames.secondPartyLabel,
          payTo: sellers,
          orderOf: {
            address: formState.address,
            cityProvincePostal: `${formState.city}, ${formState.province}, ${formState.postalCode}`,
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
          chequeDate: formState.chequeDate,
        };

        setEftReceiptData(dataForReceipt);
        setEftNumber(response.data.eftNumber);
        setShowEFTReceipt(true);
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, balanceOfDeposit: true }));
      } else {
        alert("Failed to get EFT number.");
      }
    } catch (error) {
      console.error("Error creating EFT record:", error);
      alert("Error creating EFT record. Please check the console for details.");
    }
  };

  const handleRefundEFTClick = async (formState) => {
    if (!refundForm.selectedTrade) {
      alert("No trade selected.");
      return;
    }
    const trade = refundForm.selectedTrade;

    // Get party names from the trade
    const partyNames = getPartyNamesByDealType(trade);
    const sellers = partyNames.firstParty;
    const buyers = partyNames.secondParty;

    // Validate recipient - ensure it's not "N/A" or empty
    const recipient = formState.paidTo || sellers;
    if (!recipient || recipient === "N/A" || recipient.trim() === "") {
      alert(
        "Please enter a valid recipient name. The trade does not have seller information or the recipient field is empty."
      );
      return;
    }

    // Validate amount
    const amount = parseFloat(formState.netCheque) || 5000;
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount greater than 0.");
      return;
    }

    console.log("Sending refund deposit request:", {
      tradeId: trade._id,
      amount: amount,
      recipient: recipient,
      description: formState.noteOnStub || "Transfer Refund",
      chequeDate: formState.chequeDate,
    });

    try {
      const response = await axiosInstance.post(
        "/real-estate-trust-eft/refund-deposit",
        {
          tradeId: trade._id,
          amount: amount,
          recipient: recipient,
          description: formState.noteOnStub || "Transfer Refund",
          chequeDate: formState.chequeDate,
        }
      );

      if (response.data.eftNumber) {
        const description = `Trade #: ${trade.tradeNumber}, Paid to: ${
          formState.paidTo || sellers
        }`;

        // Convert MM/DD/YYYY to proper date format
        const [month, day, year] = formState.chequeDate.split("/");
        const transactionDate = new Date(
          `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`
        );

        // 1. Post to transactions
        await axiosInstance.post("/transactions", {
          date: transactionDate,
          reference: `EFT#${response.data.eftNumber}`,
          description,
          debitAccount: "LIABILITY FOR TRUST FUNDS HELD",
          creditAccount: "CASH - TRUST",
          amount: parseFloat(formState.netCheque) || 5000,
          tradeId: trade._id,
        });

        // 2. Post to finance transactions
        await axiosInstance.post("/finance-transactions", {
          type: "RefundOfDeposit",
          chequeDate: transactionDate,
          amount: parseFloat(formState.netCheque) || 5000,
          chequeWrittenTo: formState.paidTo || sellers,
          tradeId: trade._id,
        });

        toast.success(
          "Transaction posted to Chart of Accounts and Ledger successfully!"
        );
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("refreshTrialBalance"));
        }

        const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

        const dataForReceipt = {
          eftNumber: response.data.eftNumber,
          paidTo: {
            name: formState.paidTo || sellers,
            address: formState.address,
          },
          trade: tradeAddress,
          notes: formState.noteOnStub || "Transfer Refund",
          amount: parseFloat(formState.netCheque) || 5000,
          seller: sellers,
          buyer: buyers,
          firstPartyLabel: partyNames.firstPartyLabel,
          secondPartyLabel: partyNames.secondPartyLabel,
          payTo: formState.paidTo || sellers,
          orderOf: {
            address: formState.address,
            cityProvincePostal: `${formState.city}, ${formState.province}, ${formState.postalCode}`,
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
          chequeDate: formState.chequeDate,
        };

        setEftReceiptData(dataForReceipt);
        setEftNumber(response.data.eftNumber);
        setShowEFTReceipt(true);
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, refundOfDeposit: true }));
      } else {
        alert("Failed to get EFT number.");
      }
    } catch (error) {
      console.error("Error creating EFT record:", error);
      alert("Error creating EFT record. Please check the console for details.");
    }
  };

  const CommissionDetailsForm = ({ trade, onBack }) => {
    const eftBlocked =
      Boolean(eftCreated.commissionTransfer) && !isTradeVoided(trade);
    const totalCommission =
      trade.commission?.commissionIncomeRows?.reduce(
        (sum, row) => sum + parseFloat(row.total || 0),
        0
      ) || 0;

    const trustAmount =
      trade.trustRecords?.reduce(
        (total, record) => total + parseFloat(record.amount || 0),
        0
      ) || 0;

    // If trust amount is less than total commission, use trust amount as cheque amount
    const chequeAmount =
      trustAmount < totalCommission ? trustAmount : totalCommission;

    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`;

    // Format current date as mm/dd/yyyy
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const currentDate = `${pad(now.getMonth() + 1)}/${pad(
      now.getDate()
    )}/${now.getFullYear()}`;

    const [formState, setFormState] = useState({
      chequeDate: currentDate,
    });

    const [useCustomDate, setUseCustomDate] = useState(false);

    const tableData = [
      {
        acct: "10004",
        name: "CASH - COMMISSION TRUST ACCOUNT",
        debit: chequeAmount.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        credit: "",
      },
      {
        acct: "10002",
        name: "CASH - TRUST",
        debit: "",
        credit: chequeAmount.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      },
    ];

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg text-center">
          Trust Cheques 1-Transfer to General/Commission Trust
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDateCommission"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label
                htmlFor="useCustomDateCommission"
                className="text-sm text-gray-600"
              >
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(
                          2,
                          "0"
                        )}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={formState.chequeDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              value="Trust"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>

        <div className="bg-gray-200 p-4 rounded-md mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="font-semibold">Trade #:</span>{" "}
              {trade.tradeNumber}
            </div>
            <div>
              <span className="font-semibold">Today's Date:</span> {currentDate}
            </div>
            <div>
              <span className="font-semibold">Address:</span> {address}
            </div>
            <div>
              <span className="font-semibold">Trust Amount:</span>{" "}
              {trustAmount.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
            </div>
            <div>
              <span className="font-semibold">Total Commission:</span>{" "}
              {totalCommission.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
            </div>
            <div>
              <span className="font-semibold">Cheque Amount:</span>{" "}
              {chequeAmount.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Amount of Cheque
            </label>
            <input
              type="text"
              value={chequeAmount.toFixed(2)}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Written To
            </label>
            <input
              type="text"
              value="365 Realty Brokerage"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Address
            </label>
            <input
              type="text"
              value="66 Antibes Dr"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              City
            </label>
            <input
              type="text"
              value="Brampton"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Province
            </label>
            <input
              type="text"
              value="Ontario"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Postal Code
            </label>
            <input
              type="text"
              value="L6X 5H5"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Note on Stub
          </label>
          <input
            type="text"
            value="Transfer funds to Commission Trust"
            readOnly
            className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
          />
        </div>

        <div className="text-center font-bold text-red-600 my-4">
          FUNDS MUST BE DEPOSITED IN THE COMMISSION TRUST ACCOUNT
        </div>

        <table className="min-w-full divide-y divide-gray-200 border mb-4">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                Acct #
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                General Ledger Account Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                Debit (+)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Credit (-)
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {tableData.map((row, index) => (
              <tr key={index}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-r">
                  {row.acct}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-r">
                  {row.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 border-r">
                  {row.debit}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {row.credit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-start space-x-4">
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Print
          </button>
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Batch
          </button>
          <button
            onClick={() => handleCommissionEFTClick(formState)}
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  const BalanceDetailsForm = ({ trade, onBack }) => {
    const eftBlocked =
      Boolean(eftCreated.balanceOfDeposit) && !isTradeVoided(trade);
    const [resolvedTrade, setResolvedTrade] = useState(trade);

    useEffect(() => {
      setResolvedTrade(trade);
      let cancelled = false;
      const load = async () => {
        if (!trade?._id) return;
        try {
          const { data } = await axiosInstance.get(`/trades/${trade._id}`);
          if (!cancelled) setResolvedTrade(data);
        } catch (err) {
          console.error("Could not refresh trade for Balance of Deposit:", err);
        }
      };
      load();
      return () => {
        cancelled = true;
      };
    }, [trade?._id]);

    const trustAmount =
      resolvedTrade.trustRecords?.reduce(
        (sum, record) => sum + parseFloat(record.amount || 0),
        0
      ) || 0;

    const commissionTotal =
      resolvedTrade.commission?.commissionIncomeRows?.reduce(
        (sum, row) => sum + parseFloat(row.total || 0),
        0
      ) || 0;

    const balance = trustAmount - commissionTotal;

    // Get all seller names from the trade (uses fresh /trades/:id so People edits apply)
    const partyNames = getPartyNamesByDealType(resolvedTrade);
    const sellers = partyNames.firstParty;
    const chequeWrittenTo = sellers || "N/A";
    const tradeAddress = `${resolvedTrade.keyInfo?.streetNumber || ""} ${
      resolvedTrade.keyInfo?.streetName || ""
    }${resolvedTrade.keyInfo?.unit ? ` ${resolvedTrade.keyInfo.unit}` : ""}`;
    // Format current date as mm/dd/yyyy
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const currentDate = `${pad(now.getMonth() + 1)}/${pad(
      now.getDate()
    )}/${now.getFullYear()}`;

    const [formState, setFormState] = useState({
      chequeNumber: "",
      chequeDate: currentDate,
      address: trade.keyInfo?.streetName
        ? `${trade.keyInfo.streetNumber} ${trade.keyInfo.streetName}${
            trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""
          }`
        : "",
      city: trade.keyInfo?.city || "",
      province: trade.keyInfo?.province || "",
      postalCode: trade.keyInfo?.postalCode || "",
      country: "Canada",
      noteOnStub: "Refund of Balance of Deposit",
    });

    const [useCustomDate, setUseCustomDate] = useState(false);

    useEffect(() => {
      const k = resolvedTrade?.keyInfo;
      if (!k) return;
      const addr = k.streetName
        ? `${k.streetNumber || ""} ${k.streetName}${
            k.unit ? ` ${k.unit}` : ""
          }`.trim()
        : "";
      setFormState((prev) => ({
        ...prev,
        ...(addr ? { address: addr } : {}),
        city: k.city || prev.city,
        province: k.province || prev.province,
        postalCode: k.postalCode || prev.postalCode,
      }));
    }, [resolvedTrade]);

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormState((prev) => ({ ...prev, [name]: value }));
    };

    const tableData = [
      {
        acct: "21300",
        name: "LIABILITY FOR TRUST FUNDS HELD",
        debit: balance.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        credit: "",
      },
      {
        acct: "10002",
        name: "CASH - TRUST",
        debit: "",
        credit: balance.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      },
    ];

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg text-center">
          Trust Cheques 2-Balance of Deposit
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDate"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="useCustomDate" className="text-sm text-gray-600">
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(
                          2,
                          "0"
                        )}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={currentDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              value="Trust"
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque #
            </label>
            <input
              type="text"
              name="chequeNumber"
              value={formState.chequeNumber}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>

        <div className="bg-gray-200 p-4 rounded-md mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="font-semibold">Trade #:</span>{" "}
            {resolvedTrade.tradeNumber}{" "}
            <span className="font-semibold ml-4">Status:</span> Closed
            <div>
              <span className="font-semibold">Address:</span> {tradeAddress}
            </div>
          </div>
          <div className="text-right">
            <div>
              <span className="font-semibold">Today's Date:</span> {currentDate}
            </div>
            <div>
              <span className="font-semibold">Balance:</span>{" "}
              {balance.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Amount of Cheque
            </label>
            <input
              type="text"
              value={balance.toFixed(2)}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Written To
            </label>
            <input
              type="text"
              value={chequeWrittenTo}
              title={chequeWrittenTo}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Address
            </label>
            <input
              type="text"
              name="address"
              value={formState.address}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              City
            </label>
            <input
              type="text"
              name="city"
              value={formState.city}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Province
            </label>
            <input
              type="text"
              name="province"
              value={formState.province}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Postal Code
            </label>
            <input
              type="text"
              name="postalCode"
              value={formState.postalCode}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Note on Stub
          </label>
          <input
            type="text"
            name="noteOnStub"
            value={formState.noteOnStub}
            onChange={handleInputChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        <table className="min-w-full divide-y divide-gray-200 border mb-4">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                Acct #
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                General Ledger Account Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                Debit (+)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Credit (-)
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {tableData.map((row, index) => (
              <tr key={index}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-r">
                  {row.acct}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-r">
                  {row.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 border-r">
                  {row.debit}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {row.credit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-start space-x-4">
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Print
          </button>
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Batch
          </button>
          <button
            onClick={() =>
              handleBalanceEFTClick({ ...formState, chequeWrittenTo: sellers })
            }
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  const RefundDetailsForm = ({ trade, onBack }) => {
    const eftBlocked =
      Boolean(eftCreated.refundOfDeposit) && !isTradeVoided(trade);
    // Get party names from the trade
    const partyNames = getPartyNamesByDealType(trade);
    const buyers = partyNames.secondParty;
    const sellers = partyNames.firstParty;

    const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

    // Format current date as mm/dd/yyyy
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const currentDate = `${pad(now.getMonth() + 1)}/${pad(
      now.getDate()
    )}/${now.getFullYear()}`;

    const [formState, setFormState] = useState({
      chequeDate: currentDate,
      paidTo: sellers && sellers !== "N/A" ? sellers : "",
      address: tradeAddress,
      city: trade.keyInfo?.city || "",
      province: trade.keyInfo?.province || "",
      postalCode: trade.keyInfo?.postalCode || "",
      noteOnStub: "Transfer Refund",
      netCheque: "5000", // This should be calculated based on business logic
    });

    const [useCustomDate, setUseCustomDate] = useState(false);

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormState((prev) => ({ ...prev, [name]: value }));
    };

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg text-center">
          Refund of Deposit Cheques
        </h3>

        <div className="mb-6">
          <h4 className="font-semibold mb-4 text-md">
            Refund of Deposit Cheques Details
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Trade Number
                </label>
                <input
                  type="text"
                  value={trade.tradeNumber}
                  readOnly
                  className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Bank Account
                </label>
                <input
                  type="text"
                  value="Real Estate Trust"
                  readOnly
                  className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Amount
                </label>
                <input
                  type="text"
                  value="5000"
                  readOnly
                  className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  City
                </label>
                <input
                  type="text"
                  name="city"
                  value={formState.city}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Province
                </label>
                <input
                  type="text"
                  name="province"
                  value={formState.province}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Note on Stub
                </label>
                <input
                  type="text"
                  name="noteOnStub"
                  value={formState.noteOnStub}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Buyer
                </label>
                <input
                  type="text"
                  value={buyers || ""}
                  readOnly
                  className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                />
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Cheque Date
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="useCustomDateRefund"
                    checked={useCustomDate}
                    onChange={(e) => setUseCustomDate(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label
                    htmlFor="useCustomDateRefund"
                    className="text-sm text-gray-600"
                  >
                    Override Date
                  </label>
                </div>
                {useCustomDate ? (
                  <input
                    type="date"
                    name="chequeDate"
                    value={
                      formState.chequeDate.includes("/")
                        ? (() => {
                            const [month, day, year] =
                              formState.chequeDate.split("/");
                            return `${year}-${month.padStart(
                              2,
                              "0"
                            )}-${day.padStart(2, "0")}`;
                          })()
                        : formState.chequeDate
                    }
                    onChange={(e) => {
                      const selectedDate = new Date(
                        e.target.value + "T00:00:00"
                      );
                      const formattedDate = `${(selectedDate.getMonth() + 1)
                        .toString()
                        .padStart(2, "0")}/${selectedDate
                        .getDate()
                        .toString()
                        .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                      setFormState((prev) => ({
                        ...prev,
                        chequeDate: formattedDate,
                      }));
                    }}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                  />
                ) : (
                  <input
                    type="text"
                    name="chequeDate"
                    value={formState.chequeDate}
                    readOnly
                    className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Paid To <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="paidTo"
                  value={formState.paidTo}
                  onChange={handleInputChange}
                  placeholder="Enter recipient name"
                  required
                  className={`mt-1 block w-full rounded-md shadow-sm ${
                    !formState.paidTo || formState.paidTo.trim() === ""
                      ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                />
                {(!formState.paidTo || formState.paidTo.trim() === "") && (
                  <p className="mt-1 text-sm text-red-600">
                    Recipient name is required
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Address
                </label>
                <input
                  type="text"
                  name="address"
                  value={formState.address}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Postal Code
                </label>
                <input
                  type="text"
                  name="postalCode"
                  value={formState.postalCode}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Net Cheque <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="netCheque"
                  value={formState.netCheque}
                  onChange={handleInputChange}
                  placeholder="Enter amount"
                  min="0.01"
                  step="0.01"
                  required
                  className={`mt-1 block w-full rounded-md shadow-sm ${
                    !formState.netCheque ||
                    isNaN(parseFloat(formState.netCheque)) ||
                    parseFloat(formState.netCheque) <= 0
                      ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                />
                {(!formState.netCheque ||
                  isNaN(parseFloat(formState.netCheque)) ||
                  parseFloat(formState.netCheque) <= 0) && (
                  <p className="mt-1 text-sm text-red-600">
                    Please enter a valid amount greater than 0
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Seller
                </label>
                <input
                  type="text"
                  value={sellers || ""}
                  readOnly
                  className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-start space-x-4">
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Print
          </button>
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Batch
          </button>
          <button
            onClick={() => handleRefundEFTClick(formState)}
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="flex">
        {/* Left Sidebar */}
        <FinanceSidebar />
        {/* Main Content */}
        <div className="flex-1 p-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">
              Real Estate Trust Payments
            </h2>

            {/* Secondary Horizontal Navbar */}
            <div className="bg-white py-4 border-b mb-6">
              <nav className="flex space-x-8">
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "commission-transfer"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("commission-transfer")}
                >
                  Commission transfer
                </button>
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "balance-deposit"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("balance-deposit")}
                >
                  Balance of Deposit
                </button>
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "refund-deposit"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("refund-deposit")}
                >
                  Refund of Deposit
                </button>
              </nav>
            </div>

            {/* Commission Transfer Form */}
            {activeSection === "commission-transfer" && (
              <div className="space-y-4">
                {!showDetailsForm ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Commission Transfer Form
                    </h3>
                    <form
                      onSubmit={handleCommissionSubmit}
                      className="space-y-4"
                    >
                      {/* Cheque Type */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Cheque Type
                        </label>
                        <input
                          type="text"
                          value={commissionForm.chequeType}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Trade Number Search */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={commissionForm.tradeNumber}
                          onChange={(e) =>
                            handleCommissionTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />

                        {/* Dropdown for trade search results */}
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() => selectCommissionTrade(trade)}
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Proceed Button */}
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <CommissionDetailsForm
                    trade={commissionForm.selectedTrade}
                    onBack={() => setShowDetailsForm(false)}
                  />
                )}
              </div>
            )}

            {/* Balance of Deposit Form */}
            {activeSection === "balance-deposit" && (
              <div className="space-y-4">
                {!showBalanceDetails ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Balance of Deposit Form
                    </h3>
                    <form onSubmit={handleBalanceSubmit} className="space-y-4">
                      {/* Cheque Type */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Cheque Type
                        </label>
                        <input
                          type="text"
                          value={balanceForm.chequeType}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Trade Number Search */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={balanceForm.tradeNumber}
                          onChange={(e) =>
                            handleBalanceTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />

                        {/* Dropdown for trade search results */}
                        {showTradeDropdown2 && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() => selectBalanceTrade(trade)}
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Proceed Button */}
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <BalanceDetailsForm
                    trade={balanceForm.selectedTrade}
                    onBack={() => setShowBalanceDetails(false)}
                  />
                )}
              </div>
            )}

            {/* Refund of Deposit Tab */}
            {activeSection === "refund-deposit" && (
              <div className="space-y-4">
                {!showRefundDetails ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Refund of Deposit Cheques
                    </h3>
                    <div className="space-y-4">
                      {/* Trade Number Search */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={refundForm.tradeNumber}
                          onChange={(e) =>
                            handleRefundTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />

                        {/* Dropdown for trade search results */}
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() => selectRefundTrade(trade)}
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Proceed Button */}
                      <div className="pt-4">
                        <button
                          onClick={() => {
                            if (refundForm.selectedTrade) {
                              setShowRefundDetails(true);
                            } else {
                              alert("Please select a trade first.");
                            }
                          }}
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <RefundDetailsForm
                    trade={refundForm.selectedTrade}
                    onBack={() => setShowRefundDetails(false)}
                  />
                )}
              </div>
            )}

            {/* Default content when no tab is selected */}
            {activeSection === "main" && (
              <div className="text-center py-8 text-gray-500">
                <p>Select a tab above to view specific information.</p>
              </div>
            )}

            {showEFTReceipt && eftReceiptData && (
              <EFTReceipt
                data={eftReceiptData}
                onClose={() => setShowEFTReceipt(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealEstateTrustPayments;
