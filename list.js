document.getElementById("memberForm").addEventListener("submit", async function(e) {
    e.preventDefault();
  
    const data = {
      memberId: document.getElementById("memberId").value,
      memberFirstName: document.getElementById("memberFirstName").value,
      memberMiddleName: document.getElementById("memberMiddleName").value,
      memberLastName: document.getElementById("memberLastName").value,
      memberEmail: document.getElementById("memberEmail").value,
      memberAddressLine1: document.getElementById("memberAddressLine1").value,
      memberAddressLine2: document.getElementById("memberAddressLine2").value,
      memberMobileNumber: document.getElementById("memberMobileNumber").value,
      memberWorkStatus: document.getElementById("memberWorkStatus").value,
      membershipPeriod: document.getElementById("membershipPeriod").value,
      memberDob: document.getElementById("memberDob").value
    };
  
    try {
      const response = await fetch("https://dev-api.humhealth.com/LibraryManagementAPI/members/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });
  
      const result = await response.json();
  
      document.getElementById("responseMsg").innerText =
        result.message || "Updated successfully!";
        
    } catch (error) {
      console.error(error);
      document.getElementById("responseMsg").innerText =
        "Error updating member!";
    }
  });