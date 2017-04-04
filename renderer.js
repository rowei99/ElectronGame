<<<<<<< HEAD
//const electron = require('electron')
// $(This) file is requicreature3 by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in $(this) process.




var deck = ["creature1", "creature2", "creature2", "creature2", "creature2", "creature3", "creature2", "creature3", "creature3"]
var shuffle = []
var decklocation = 0
var length = deck.length
for (var i = 0; i < length; i++) {
    var rand = Math.floor((Math.random() * deck.length))
    shuffle.push(deck[rand])
    deck.splice(rand, 1)
}
var shuffle_length = shuffle.length
$("#deck").click(function(){
    if(decklocation < shuffle_length){
        if($("#card1").hasClass("empty")){
            $("#card1").removeClass("empty")
            $("#card1").addClass(shuffle[decklocation])
            decklocation = decklocation + 1
        }else if($("#card2").hasClass("empty")){
            $("#card2").removeClass("empty")
            $("#card2").addClass(shuffle[decklocation])
            decklocation = decklocation + 1
        }else if($("#card3").hasClass("empty")){
            $("#card3").removeClass("empty")
            $("#card3").addClass(shuffle[decklocation])
            decklocation = decklocation + 1
        }else if($("#card4").hasClass("empty")){
            $("#card4").removeClass("empty")
            $("#card4").addClass(shuffle[decklocation])
            decklocation = decklocation + 1
        }else if($("#card5").hasClass("empty")){
            $("#card5").removeClass("empty")
            $("#card5").addClass(shuffle[decklocation])
            decklocation = decklocation + 1
        }
    }
});
$(".card").click(function(){
    var classlist = $(this).attr('class').split(/\s+/)
    console.log(classlist)
    var transfer = classlist.indexOf("card")
    classlist.splice(transfer, 1)
    console.log(classlist[0])
    var cardclass = classlist[0]
    var placenum = this.id.replace('card','')
    $("#played" + placenum).addClass(cardclass)
    $("#played" + placenum).removeClass("empty")
    $(this).removeClass(cardclass)
    $(this).addClass("empty")
=======
const electron = require('electron')
// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.
$("#go").click(function(){
    $("#output").html("TESTING")
    console.log('working')
>>>>>>> 51dab681bcfe9ed3f37603b63da5516dd3750438
});